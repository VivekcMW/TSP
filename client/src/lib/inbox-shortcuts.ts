/** Gmail-style shortcuts work while a list row has focus, but never while typing or inside menus/dialogs. */
export function ignoreInboxShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return true;
  const target = event.target;
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='listbox'], [role='menu'], [role='menuitem'], [role='dialog'], [role='alertdialog']",
  ));
}

export const INBOX_SHORTCUTS: ReadonlyArray<readonly [key: string, action: string]> = [
  ["c", "Compose a LinkedIn post"],
  ["j / k", "Next / previous item"],
  ["o", "Open the selected item"],
  ["r", "Draft my take"],
  ["s", "Save to Shortlist or move back"],
  ["e", "Mark not relevant"],
  ["x", "Select the item"],
  ["u", "Back to the list"],
  ["/", "Search"],
  ["?", "Show shortcuts"],
];
