# Vortex Browser

Vortex Browser is a lightweight Windows web browser built with Electron. The current version is **0.4.2**.

## Features

- Multi-tab browsing, tab groups, tab hibernation, and session restore
- Bookmarks, searchable history, quick links, and configurable homepage
- Multiple light and dark themes
- Incognito browsing, tracker/ad and fingerprinting protection, third-party cookie blocking, tracking-parameter removal, HTTPS-only and WebRTC protection
- Per-site privacy shield, site-data cleanup and exceptions, persistent permission controls, clear-on-exit, and a local privacy dashboard
- Download handling and automatic updates
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

Create Windows packages:

```powershell
npm run build
```

Portable and unpacked builds are also available through `npm run build:portable` and `npm run build:dir`.

## Project status

Development priorities and outstanding larger features are tracked in [ROADMAP.md](ROADMAP.md). Release details are in [CHANGELOG.md](CHANGELOG.md).

## License

ISC
