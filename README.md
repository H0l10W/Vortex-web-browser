# Vortex Browser

Vortex Browser is a lightweight Windows web browser built with Electron. The current version is **0.5.0**.

## Features

- Multi-tab browsing, tab groups, tab hibernation, and session restore
- Searchable and vertical tabs, saved workspaces, and customizable toolbar pins
- Bookmark folders, bookmark search and backup/restore, searchable history, quick links, and configurable homepage
- Isolated browser profiles for separate cookies, history, bookmarks, settings, credentials, and sessions
- Multiple light and dark themes
- Incognito browsing, tracker/ad and fingerprinting protection, third-party cookie blocking, tracking-parameter removal, HTTPS-only and WebRTC protection
- Per-site privacy shield, site-data cleanup and exceptions, persistent permission controls, clear-on-exit, and a local privacy dashboard
- Download handling and automatic updates
- Searchable settings, a toolbar profile picker, and customizable new-tab layouts
- Developer tools and basic performance monitoring
- Windows file associations and HTTP/HTTPS protocol registration

## Development

Requirements: Node.js and npm on Windows.

```powershell
npm install
npm start
```

Run all automated checks:

```powershell
npm run check
```

Run the workspace data tests and isolated Electron UI checks:

```powershell
npm run workspace:test
npm run ui:test
```

UI checks use disposable profiles and save screenshots and results under `dist/ui-smoke-*`.
See [the interface guide](docs/INTERFACE.md) for the new controls and shortcuts.

Create Windows packages:

```powershell
npm run build
```

Portable and unpacked builds are also available through `npm run build:portable` and `npm run build:dir`.

Measure startup and verify a completed release directory:

```powershell
npm run benchmark
npm run release:verify
```

## Project structure

```text
assets/styles/   Browser, Settings, and History styles
docs/            Roadmaps, working notes, and archived documents
icons/           Application and interface icons
scripts/         Developer setup scripts
src/history/     History page controller
src/preload/     Secure Electron context bridges
src/renderer/    Main browser UI and widgets
src/settings/    Settings UI and services
src/suggestions/ Address-bar suggestion overlay
tests/           Automated security audit
vendor/          Third-party code and licenses
wallpapers/      Bundled new-tab backgrounds and credits
```

The root contains only Electron/package entry points, local HTML pages, build metadata, and primary project documentation.

## Project status

Development priorities and outstanding larger features are tracked in [docs/ROADMAP.md](docs/ROADMAP.md). Release details are in [CHANGELOG.md](CHANGELOG.md).

## License

ISC
