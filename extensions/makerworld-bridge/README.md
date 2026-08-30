# Workshop MakerWorld Bridge

Personal Safari Web Extension for importing protected MakerWorld files into
Workshop without giving Workshop a MakerWorld password, access token, refresh
token, or cookie.

## Important

MakerWorld does not publish a third-party OAuth or download API. This extension
uses the signed-in Safari session to request the same short-lived download URLs
used by the MakerWorld web app. It is unofficial, may stop working, and
MakerWorld's terms restrict automated acquisition. Keep it personal and
sideloaded; disable it if MakerWorld objects or changes its service.

## Build for macOS and iPhone

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

## Use

1. Import a MakerWorld URL into Bambu Hub normally.
2. Sign in to MakerWorld in Safari.
3. Open the Bambu project in Workshop web.
4. Choose **Import from MakerWorld**.
5. Safari briefly opens the MakerWorld page, gathers its protected file links,
   returns to Workshop, and lets the server download them.

If MakerWorld presents a verification challenge, complete it in the opened tab
and retry.
