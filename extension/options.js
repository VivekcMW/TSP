import { getSettings, hostPattern, isValidKey, normalizeAppUrl } from "./capture.js";

const form = document.getElementById("settings-form");
const appUrlInput = document.getElementById("app-url");
const tokenInput = document.getElementById("token");
const status = document.getElementById("status");

function show(message, kind) {
  status.textContent = message;
  status.className = kind;
}

const current = await getSettings();
appUrlInput.value = current.appUrl;
tokenInput.placeholder = current.token ? "Saved. Enter a new key to replace it." : "tsp_cap_…";

form.addEventListener("submit", async event => {
  event.preventDefault();
  const origin = normalizeAppUrl(appUrlInput.value);
  if (!origin) {
    show("Enter the app address, starting with https://.", "error");
    appUrlInput.focus();
    return;
  }
  const token = tokenInput.value.trim() || current.token;
  if (!isValidKey(token)) {
    show("Paste the key exactly as shown in TheSocialPundit. It starts with tsp_cap_.", "error");
    tokenInput.focus();
    return;
  }
  // Must run inside the click: Chrome only shows the permission prompt for a user action.
  const granted = await chrome.permissions.request({ origins: [hostPattern(origin)] }).catch(() => false);
  const previous = normalizeAppUrl(current.appUrl);
  if (previous && previous !== origin && hostPattern(previous) !== hostPattern(origin)) {
    await chrome.permissions.remove({ origins: [hostPattern(previous)] }).catch(() => undefined);
  }
  await chrome.storage.local.set({ appUrl: origin, token });
  Object.assign(current, { appUrl: origin, token });
  tokenInput.value = "";
  tokenInput.placeholder = "Saved. Enter a new key to replace it.";
  show(granted
    ? "Saved. Use the toolbar button or right-click a page to save it."
    : "Saved. Chrome access to the app was not allowed. Saving may still work; if it fails, save these settings again and allow access.", granted ? "ok" : "");
});

document.getElementById("remove").addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  current.token = "";
  tokenInput.value = "";
  tokenInput.placeholder = "tsp_cap_…";
  show("Key removed from this browser. Revoke it in TheSocialPundit if you no longer need it.", "");
});
