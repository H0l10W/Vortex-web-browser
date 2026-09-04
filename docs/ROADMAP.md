# Vortex Browser Roadmap

## Current release

**Version 0.5.0**

Version 0.5.0 adds isolated browser profiles, a complete bookmark manager, a current Electron runtime, quieter production diagnostics, and improved human-verification compatibility.

## Current priorities

### Reliability and security

- [ ] Expand automated coverage beyond linting and the static security audit
- [ ] Add crash recovery tests and structured crash reporting
- [ ] Review and harden webview navigation, permissions, and process isolation
- [ ] Add safe-browsing warnings and stronger certificate management
- [ ] Complete an accessibility audit, including keyboard and screen-reader flows

### Browser essentials

- [ ] Improve URL-bar shortcuts and recently visited suggestions
- [x] Add bookmark folders, search, and import/export
- [ ] Improve download queue management, resumption, and history
- [ ] Add recently closed tab recovery, tab pinning, and tab muting
- [ ] Add picture-in-picture and improved media controls

### Extensions and customization

- [ ] Define a restricted extension framework
- [ ] Add local extension loading and management
- [ ] Add customizable keyboard shortcuts and toolbar layout
- [ ] Add custom theme creation and import/export

### Sync and workspaces

- [x] Add multiple isolated browser profiles
- [ ] Add workspace management within profiles
- [ ] Design secure sync for bookmarks, settings, history, and open tabs
- [ ] Add session export/import

## Before 1.0

- [ ] Comprehensive unit, integration, and end-to-end test suites
- [ ] Repeatable startup, memory, and page-load benchmarks
- [ ] Independent security review
- [ ] Complete user and contributor documentation
- [ ] Crash reporting and recovery validation
- [ ] Installer, portable-build, update, and file-association release testing

## Later considerations

- macOS and Linux support
- Encrypted password management
- Cross-device sync
- Public plugin/API ecosystem
- Advanced accessibility and voice controls

This roadmap is intentionally outcome-focused. Completed release details belong in the changelog.

**Last updated:** 4 September 2026

**Next review:** September 2026
