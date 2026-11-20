import { isSavableUrl, saveToShortlist } from "./capture.js";

const MENU_ID = "save-to-thesocialpundit";
const DEFAULT_TITLE = "Save to TheSocialPundit";

chrome.runtime.onInstalled.addListener(details => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: DEFAULT_TITLE, contexts: ["page", "selection", "link"] });
  });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

/** A short badge on the toolbar button: the extension asks for no notification permission. */
function flag(tabId, ok, message) {
  const target = typeof tabId === "number" ? { tabId } : {};
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#15803d" : "#b91c1c", ...target });
  chrome.action.setBadgeText({ text: ok ? "✓" : "!", ...target });
  chrome.action.setTitle({ title: `TheSocialPundit: ${message}`, ...target });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", ...target });
    chrome.action.setTitle({ title: DEFAULT_TITLE, ...target });
  }, 5000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  // A right-clicked link (with no selection) saves the link's page; otherwise the current page.
  const target = info.linkUrl && !info.selectionText
    ? { url: info.linkUrl, title: "" }
    : { url: info.pageUrl || tab?.url, title: tab?.title || "", selection: info.selectionText || "" };
  if (!isSavableUrl(target.url)) {
    flag(tab?.id, false, "Only web pages can be saved.");
    return;
  }
  try {
    const result = await saveToShortlist(target);
    flag(tab?.id, true, result.noteMessage ? `${result.message} ${result.noteMessage}` : result.message || "Saved to your Shortlist.");
  } catch (error) {
    flag(tab?.id, false, error.message);
    if (error.kind === "setup") chrome.runtime.openOptionsPage();
  }
});
