import { getSettings, isSavableUrl, isValidKey, saveToShortlist } from "./capture.js";

const form = document.getElementById("save-form");
const setup = document.getElementById("setup");
const status = document.getElementById("status");
const saveButton = document.getElementById("save");

function show(message, kind) {
  status.textContent = message;
  status.className = kind;
}

document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("options-link").addEventListener("click", event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

// The toolbar click grants activeTab, which exposes this tab's address and title.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const { token } = await getSettings();

if (!isValidKey(token)) {
  setup.hidden = false;
} else if (!tab || !isSavableUrl(tab.url)) {
  show("This page can't be saved. Open a web page (http or https) and try again.", "error");
} else {
  document.getElementById("page-title").textContent = tab.title || tab.url;
  document.getElementById("page-url").textContent = tab.url;
  form.hidden = false;
  document.getElementById("note").focus();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    saveButton.disabled = true;
    show("Saving…", "");
    try {
      const result = await saveToShortlist({ url: tab.url, title: tab.title, note: document.getElementById("note").value });
      show(result.noteMessage ? `${result.message} ${result.noteMessage}` : result.message || "Saved to your Shortlist.", "ok");
    } catch (error) {
      show(error.message, "error");
      saveButton.disabled = false;
      if (error.kind === "setup") setup.hidden = false;
    }
  });
}
