# Workshop MakerWorld Bridge

Personal Chrome and Safari extension for importing protected MakerWorld files
into Workshop without giving Workshop a MakerWorld password, access token,
refresh token, or cookie.

## Important

MakerWorld does not publish a third-party OAuth or download API. This extension
uses the signed-in browser session to request the same short-lived download URLs
used by the MakerWorld web app. It is unofficial, may stop working, and
MakerWorld's terms restrict automated acquisition. Keep it personal and
sideloaded; disable it if MakerWorld objects or changes its service.

## Install in Google Chrome on macOS or Windows

Chrome can load the checked-in extension directly; no build step or Chrome Web
Store account is required.

1. Download or clone this repository and extract it to a permanent location.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the `extensions/makerworld-bridge` folder — the folder containing
   `manifest.json`.
6. Pin **Workshop MakerWorld Bridge** from Chrome's Extensions menu.

Install the unpacked extension separately on each computer; Chrome does not sync
unpacked extensions. On Windows, select the same `extensions\makerworld-bridge`
folder after extracting the repository. Keep the folder in place while the
extension is installed.

Chrome will show access for only:

- `makerworld.com`
- `workshop.nintek.com`
- `app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net`

The extension has no browser-cookie, browsing-history, or download permission.
MakerWorld cookies remain in Chrome and are used only by MakerWorld's own tab.

To create a clean ZIP for copying to another computer, run this on macOS or
another system with `zip` installed:

```bash
npm run extension:chrome
```

Extract `.chrome-extension-build/workshop-makerworld-bridge.zip` on the other
computer, then select the extracted folder with **Load unpacked**.

## Build for Safari on macOS and iPhone

From the Workshop repository:

```bash
./scripts/generate-makerworld-safari-extension.sh
```

The generated Xcode project is written under `.safari-extension-build/` and
targets both macOS and iOS. Build and run the containing app on each device,
then enable **Workshop MakerWorld Bridge** in Safari Extensions and grant access
only to:

- `makerworld.com`
- `workshop.nintek.com`

The generator applies Workshop's development team (`3KB968X34U`) to every
generated target. Override it only when needed:

```bash
DEVELOPMENT_TEAM=YOURTEAMID ./scripts/generate-makerworld-safari-extension.sh
```

If the host app opens but Safari does not list the extension, rerun the
generator, clean the generated Xcode project, and run the macOS scheme again.
An app whose signature says `TeamIdentifier=not set` was built ad hoc and Safari
will hide its extension.

The extension stores no account credentials and has no browser-cookie
permission. A user-triggered import sends only short-lived signed file URLs to
a one-time Workshop job. Workshop consumes them immediately, stores the files
privately, and never persists the signed URLs.

## Use in Chrome or Safari

1. Import a MakerWorld URL into Bambu Hub normally.
2. Sign in to MakerWorld in the browser where the extension is installed.
3. Open the Bambu project in Workshop web.
4. Choose **Import from MakerWorld**.
5. The extension briefly opens the MakerWorld page, gathers its protected file
   links, returns to Workshop, and lets the server download them.

If MakerWorld presents a verification challenge, complete it in the opened tab
and retry.
