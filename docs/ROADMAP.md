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

- [x] Improve address suggestions and switch to existing tabs
- [x] Add searchable tabs and optional vertical tabs
- [x] Add settings search and a visible profile switcher
- [x] Add bookmark folders, search, and import/export
- [ ] Improve download queue management, resumption, and history
- [x] Add recently closed tab recovery and tab muting
- [ ] Add tab pinning
- [x] Add picture-in-picture and improved media controls
- [x] Add a toolbar downloads panel with progress and file actions

### Extensions and customization

- [ ] Define a restricted extension framework
- [ ] Add local extension loading and management
- [x] Add customizable toolbar pins and new-tab layout
- [ ] Add customizable keyboard shortcuts
- [ ] Add custom theme creation and import/export

### Sync and workspaces

- [x] Add multiple isolated browser profiles
- [x] Add saved workspace snapshots within profiles
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

**Last updated:** 5 September 2026

**Next review:** September 2026
