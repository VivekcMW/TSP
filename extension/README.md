# Save to TheSocialPundit (Chrome extension)

A small Manifest V3 extension that saves the page you are reading, a link, or selected text to your
TheSocialPundit **Shortlist**. Selected text and your optional note are also saved to **Notes**.
Nothing is ever posted. Plain JavaScript, no build step, no dependencies.

## Install (unpacked, for testing)

1. In TheSocialPundit, open the Inbox, choose **More connectors** in the right-hand rail, and under
   **Save from any page** select **Create key**. Copy the key; it is shown only once.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Select **Load unpacked** and choose this `extension/` folder.
4. The options page opens. Enter the app address (for example `https://www.thesocialpundit.com`, or
   `http://localhost:4300` for local development) and paste the key. Select **Save settings** and allow
   access when Chrome asks.

## Use

- **Toolbar button**: opens a small window with the page title. Add an optional note and select
  **Save to Shortlist**.
- **Right-click** a page, a link or selected text and choose **Save to TheSocialPundit**. A green ✓ or a red !
  appears on the toolbar button for a few seconds; hover it to read the result.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the current tab's address and title, only after you click the button or menu item. |
| `contextMenus` | The right-click **Save to TheSocialPundit** item. |
| `storage` | Keep the app address and key in this browser (`chrome.storage.local`, not synced). |
| optional host access | Requested at runtime for the one app address you enter, nothing else. |

The extension reads no page content except the text you select, and sends it only to the app address you set.

## Package and publish

1. Add icons (16, 32, 48 and 128 px PNG) and an `"icons"` entry to `manifest.json`; the Chrome Web Store requires them.
2. Bump `version` in `manifest.json`.
3. Zip the folder contents (not the folder itself): `cd extension && zip -r ../save-to-thesocialpundit.zip . -x README.md`.
4. Upload the zip in the Chrome Web Store Developer Dashboard, fill in the privacy tab (justify each permission
   as above; data is sent only to the user's own TheSocialPundit account) and submit for review.
5. Once published, set `VITE_CAPTURE_EXTENSION_URL` to the store listing so the app links to it.

See `docs/external-inputs.md` for the server side and security notes.
