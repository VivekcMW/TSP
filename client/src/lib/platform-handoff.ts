export type PlatformHandoffResult = "opened" | "copy-failed" | "open-failed" | "abandoned";

// An async boundary captures unavailable/synchronously throwing clipboard APIs
// as well as permission rejection, while starting the write immediately.
async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Call directly from a user gesture. This copies/opens, never publishes.
 * Abandonment prevents navigation; an already-started clipboard write cannot be undone.
 */
export async function copyAndOpenPlatform(text: string, destination: string, canProceed?: () => boolean): Promise<PlatformHandoffResult> {
  const owned = () => {
    try { return canProceed?.() ?? true; }
    catch { return false; }
  };
  if (!owned()) return "abandoned";
  // Start while the source document still has focus (before opening a tab).
  const copy = writeClipboard(text).then(() => true, () => false);

  let popup: Window | null = null;
  const closePopup = () => {
    try { popup?.close(); } catch { /* A closed or unavailable tab needs no recovery navigation. */ }
  };
  try {
    // Reserve synchronously, before awaiting clipboard permission. Using the
    // noopener feature here returns null even on success in some browsers, so
    // isolate the blank tab ourselves BEFORE navigating to any external site.
    popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
  } catch {
    closePopup();
    popup = null;
  }

  const copied = await copy;
  if (!owned()) {
    closePopup();
    return "abandoned";
  }
  if (!copied) {
    closePopup();
    return "copy-failed";
  }
  if (!popup || popup.closed) return "open-failed";
  try {
    // A parent-initiated location.replace uses the parent's referrer policy,
    // even with a no-referrer meta tag in the blank tab. Use an explicit link.
    const link = popup.document.createElement("a");
    link.href = destination;
    link.target = "_self";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    popup.document.body.appendChild(link);
    // Keep this check adjacent to the external side effect, not just admission
    // or clipboard completion: the original text/draft must still own it.
    if (!owned()) {
      closePopup();
      return "abandoned";
    }
    link.click();
    return "opened";
  } catch {
    closePopup();
    return "open-failed";
  }
}