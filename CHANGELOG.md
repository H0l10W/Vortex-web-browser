# Vortex Browser - Changelog

## [0.3.8] - 2026-08-08

### ✨ Added
- File Type Associations: Vortex can now open `.html`, `.htm`, `.mhtml`, and `.mht` files directly from the OS (double-click to open, right-click "Open with").
- Protocol Handler Registration: `http://` and `https://` URL schemes registered with the OS installer so Vortex can be set as the default browser.
- Set as Default Browser: New button in General Settings to register Vortex as the default browser at runtime.
- Single-instance enforcement: Only one Vortex process runs at a time — opening a file or link while Vortex is already running opens it as a new tab in the existing window instead of spawning a second instance.
- Command-line file/URL opening: Files and URLs passed as command-line arguments (e.g. from the OS shell or "Open With") are opened as tabs on launch.
- Added inclusive date and time range filters to the full history page, with a reset action and matching-result count.
- Added dedicated visit dates and timestamps to individual history entries.

### 🔧 Changed
- Adjusted scrollbar appearance throughout the app.
- Changed the tab "close" button.
- DevTools now open with `mode: "detach"` for real webpages and `mode: "right"` for local pages (settings, new tab) for consistent behaviour.
- Fixed "View All History" button always touching the bottom edge of the quick history panel.
- Redesigned tabs as compact bordered pills with improved spacing, hover states, active elevation, pinned-tab sizing, and dark/incognito theme support.
- Added a neutral slate color for ungrouped tabs that is distinct from every selectable tab-group color, with group-colored borders and subtle tints for grouped tabs.
- Restyled and aligned the tab-group menu button with the pill tab bar.
- Simplified history URLs by removing protocols, `www.`, and unnecessary root slashes while retaining readable paths.
- Refined the complete browser interface with denser Chrome/Edge-inspired spacing while retaining Vortex's rounded pill design.
- Redesigned the browser toolbar, address bar, bookmarks bar, quick settings panel, and recent-history panel with consistent sizing, alignment, elevation, and responsive behaviour.
- Modernized the full settings and history pages with clearer navigation, card hierarchy, filters, actions, and responsive layouts.
- Reworked the theme system around true-neutral charcoal surfaces and vivid per-theme accents, removing the previous murky blue-green cast.
- Applied each selected theme's bright accent color consistently to all circular browser controls, including navigation, Home, bookmarks, history, settings, new tab, and tab groups.
- Improved active, hover, pressed, and keyboard-focus states throughout light and dark themes.
- Refined the top browser chrome with larger, less cramped tabs, clearer active-tab connection to the toolbar, quieter inactive-tab states, improved group color markers, and restored accent hover effects for toolbar action buttons.
- Polished tab text layout with larger labels, more title room, stable favicon/close-button sizing, and descender-safe clipping so letters such as `g`, `y`, and `p` render cleanly.
- Updated grouped tabs to use a persistent single-outline border in the group color so grouped tabs remain identifiable when inactive, active, and hovered.
- Unified tab-group popovers, context menus, group rename UI, and group management menus with consistent spacing, rounded corners, shadows, item alignment, and dark-theme styling.
- Added project-level `lint` and `check` scripts so linting and the security audit can be run through npm.
- Tightened packaged app file exclusions to avoid shipping IDE folders, build cache, signing certificates, partial downloads, logs, and generated security reports.

### 🐛 Fixed
- Fixed flashing when switching tabs by updating only the active tab state and keeping inactive webviews composited while hidden.
- Fixed the tab-group menu so its button toggles it closed and clicks anywhere outside it—including inside webpages or outside the app window—dismiss it.
- Fixed tab overflow so tabs compress and truncate before reaching the reserved minimize, maximize, and close controls.
- Fixed the tab-group management gap so no space is reserved when there are no live tab groups.
- Fixed stale, empty, invalid, or orphaned tab groups from lingering in saved state and affecting the tab strip.
- Fixed tab group rename, color-change, remove, and delete flows to use current group state reliably and avoid stale references.
- Fixed tab close button alignment and accessibility, including centered rendering plus keyboard activation with Enter and Space.
- Replaced broken mojibake symbols in tab/group menu paths with stable rendered symbols.
- Removed stale version debug output from the app version IPC handler.
- Removed generated security report artifacts and a stray partial download from the workspace.

## [0.3.7] - 2026-04-12

### ✨ Added
- Added theme colors in more places in the app such as the tab "close" button.
- Added more themes.


## [0.3.7] - 2026-04-12

### 🔧 Changed
- Polished browser UI styling with cleaner tab chrome, refined title bar appearance, and improved toolbar button layout.
- Updated tab spacing, hover states, active tab contrast, and subtle divider visuals for a more modern window look.
- Updated Ad Blocker and made improvements.
- Various fixes and improvements.

## [0.3.6] - 2025-12-11

### ✨ Added
- Custom window dragging: drag the window from anywhere on the title bar while keeping the entire tab bar as a drop zone for tabs.
- Double-click title bar to maximize/restore window.

### 🔧 Changed
- Completely rewrote tab drag-and-drop system for improved reliability and consistency.
- Tab bar now accepts drops anywhere (left/right of tabs, above tabs, on new tab button) just like Chrome.
- Improved window closing logic: automatically closes source windows when tabs are reattached.
- Enhanced drop zone detection using screen coordinates for accurate cross-window tab transfers.

### 🐛 Fixed
- Fixed tab reattachment: dragging a tab back into the original window now properly reattaches instead of opening a new window.
- Fixed source window cleanup: empty windows and windows created for drag operations now close automatically when tabs are moved.
- Fixed drop zone consistency: entire tab bar area now reliably accepts tab drops regardless of cursor position.
- Fixed transferId synchronization issues that prevented tabs from reattaching correctly.
- Fixed new tab button being blocked by drop overlay.
- Fixed window controls blocking drop events on the tab bar.

### ⚡ Performance
- Optimized drag-and-drop event handling with proper event propagation and passive listeners.
- Reduced unnecessary IPC calls during drag operations.

---

## [0.3.5] - 2025-12-10

### ✨ Added
- Force Web Dark Mode: per-view and global toggles with `apply-web-dark-mode` / `apply-web-dark-mode-all` and UI controls.
- Global toast/notification system (`notifications.notify`) with main/preload forwarding and theme-aware toast CSS.
- Modular history manager (`renderer-modular/history-manager.js`) and improved `history.html`/`history.js` layout and incremental rendering.
 - Custom right-click context menu for links in web content (open link in new tab, open in new window, copy link, open in default browser).
 - Drag-and-drop tabs: reorder tabs within a window, drag a tab out to create a new window, and drag a tab into another window to attach it.

### 🔧 Changed
- Centralized toast CSS and theme variables in `style.css`/`settings.css`; UI now prefers non-blocking toasts over `alert()`.
- Optimized history persistence: debounced writes, in-memory buffering, merge with opener windows, and favicon caching.
- Improved updater UX: throttled progress updates, bottom-left toasts, retries on failures, and a short silence window to reduce spam.
- Converted scroll listeners to passive and switched large DOM updates to `requestIdleCallback` for smoother UI.

### 🐛 Fixed
- Fixed history restore after restart and added `did-fail-load` fallback to ensure local pages open reliably.
- Fixed `clear-history` to clear both memory and persistent storage and added cross-window sync (`request-clear-history`).
- Prevented Force Web Dark Mode from injecting into internal pages (settings/history) and prevented duplicate CSS inserts.
- Cleaned up view metadata when BrowserViews are destroyed to avoid memory leaks.
 - Fixed: 'Open Link in New Window' now opens a standalone window with only the target link (no duplicated tabs/state).

### ⚡ Performance
- Improved rendering performance on the history page with incremental DOM updates and debounced storage.
- Reduced UI spam from updater events and heavy DOM work by batching and throttling.


### 🔧 Bug Fixes & Improvements
- Fixed history & local page restore: `history.html` and `settings.html` now load reliably after restart (converted to platform-safe file:// URLs and fallback to loadFile on failure).
- Hidden URL and bookmark bars on internal pages (history/settings) for cleaner UI.
- Improved auto-updater UX and reliability: progress updates throttle every 10%, retry on download errors, dismissible notifications with short silence window, and moved notifications to bottom-left.
- Performance & UX: debounce and batch storage writes, incremental history rendering, favicon caching, and reduced UI spam from progress events.
- Refactored history buffering & persistence into a modular `renderer-modular/history-manager.js` for clarity and better error handling.
- Minor fixes: small fixes and several small UI/behavior improvements.

---

## [0.3.2] - 2025-12-09

### 🔧 Bug Fixes & Improvements
- Fixed an issue where overlays could block typing in the URL bar; URL input is now reliably focusable and responsive.
- Improved history persistence and rendering: recent visits are now flushed reliably, and the history panel/page refreshes automatically or via the new "Refresh" button.
- Stability improvements and small UX fixes (sidebar behaviour, overlay focus handling).
 - Performance optimizations: debounce and batch storage writes, favicon caching, and incremental rendering to reduce UI latency.
 - Fixed restore and load issue for local pages after restart (history/settings pages now load correctly on Windows and other platforms).
 - Moved update notifications to bottom-left, made them dismissible, and added a short silence window to prevent reappearing immediately.
 - Improved auto-updater reliability: throttled progress updates, added retries on failure, and better error handling & diagnostics.

---

## [0.3.1] - 2025-12-09

### ✨ New Features & Fixes
- **All Settings Now Functional**: Every setting in the browser now works and applies to both the browser UI and webpages as intended.
- **Tab Behavior Settings**: 'Close All Tabs on Exit' and 'Show Tab Previews' now work correctly.
- **Zoom, Images, JavaScript, Popups**: All browser and webpage settings apply instantly and persist across sessions.
- **Smooth Scrolling & Animations**: UI and webpage settings for scrolling and animations are now fully applied.
- **Robust Tab Restoration**: Improved tab restoration logic and error handling after restart.

### 🐛 Bug Fixes
- Fixed: Settings page and tabs failing to load after restart.
- Fixed: Tab previews toggle now updates tab display instantly.
- Fixed: Close tabs on exit now clears session tabs as expected.
- Fixed: All settings now persist and apply correctly.

### 🛠️ Technical Changes
- Improved IPC and settings communication.
- Enhanced tab rendering logic for previews.
- Better persistent storage and session management.

---

## [0.3.0] - 2025-12-08

### ✨ New Features
- **Modern Settings Interface**: Complete redesign with card-based layout and organized sections.
- **Download Folder Picker**: Native system dialog for choosing download location.
- **Enhanced Tab Management**: Improved tab restoration after browser restart.
- **Smart Sidebar Positioning**: Settings sidebar now properly avoids blocking browser controls.

### 🐛 Bug Fixes
- **Fixed Tab Refresh Issue**: Tabs no longer refresh unnecessarily when closing other tabs.
- **Fixed Settings Tab Persistence**: Settings page now maintains state when switching between tabs.
- **Fixed Sidebar Overlap**: Resolved issue where settings sidebar blocked browser navigation.
- **Fixed Weather Widget**: Enhanced dual API fallback system with improved error handling and timeouts.

### 🔧 Improvements
- **Code Cleanup**: Removed debug logs and unused files for better performance.
- **CSS Optimization**: Consolidated theme styles and simplified selectors.
- **Memory Management**: Improved garbage collection and tab hibernation.
- **UI Polish**: Better spacing, modern controls, and responsive design.

### 🛠️ Technical Changes
- Enhanced IPC communication for settings management.
- Improved view lifecycle management for Electron BrowserViews.
- Streamlined auto-updater configuration.
- Better persistent storage integration.

---

## [0.2.2] - 2025-12-07

### 🎨 Major UI Modernization
- **Chrome-like floating tabs**: Complete redesign with overlapping tabs, rounded corners, and shadows.
- **Enhanced tab system**: Increased tab height from 34px to 38px for better visual presence.
- **Improved spacing**: Better tab positioning with optimized add button placement.
- **Professional shadows**: Added subtle shadows to floating tabs for depth and modern appearance.

### 🔧 Positioning & Layout Fixes
- **Fixed webview positioning**: Resolved issues where webpage content overlapped URL bar and controls.
- **Accurate header calculations**: Precise height calculations (129px with bookmarks, 92px without).
- **Bookmark bar auto-hiding**: Fixed positioning when bookmark bar shows/hides dynamically.
- **Settings page improvements**: Reduced gaps and improved layout spacing.

### 🎯 Window Controls Enhancement
- **Consistent theming**: Window controls maintain gray appearance across all color themes.
- **Red close button**: Close button shows red background on hover regardless of theme.
- **Rounded controls**: Added 6px border radius to window control buttons.
- **Proper spacing**: Moved close button away from window edge with padding.

### 🛠️ Technical Improvements
- **Theme isolation**: Comprehensive CSS overrides to prevent theme interference.
- **Code organization**: Fixed syntax errors and improved CSS structure.
- **Performance optimization**: Better rendering and reduced style conflicts.

## [0.2.1] - 2025-11-XX

### 🔄 Auto-Updater System
- Complete implementation of electron-updater.
- GitHub releases integration.
- Professional notification system with progress tracking.
- One-click update installation with app restart.
- Smart notification management with cooldown systems.

### 🎯 Icon & Branding
- Custom application icon implementation.
- Proper icon embedding in executable.
- Fixed icon caching issues.

### 📦 Build System
- ASAR packaging enabled for security.
- Automated publishing pipeline.
- GitHub repository configuration for releases.

## [0.2.0] - 2025-10-XX

### 🛡️ Major Security Overhaul
- Re-enabled Chromium sandbox for enhanced security.
- HTTPS enforcement with automatic HTTP to HTTPS conversion.
- Enhanced Content Security Policy (CSP).
- Certificate validation and error handling.

### 📱 Widget System Enhancement
- **Weather Widget**: Manual location input, geocoding integration.
- **News Widget**: Multi-country support, category filtering.
- Better error handling and fallback mechanisms.

### 🎛️ Settings System Redesign
- Complete UI redesign with modern card layouts.
- Organized sections (Appearance, Privacy, About).
- Enhanced theme selector.
- Cleaner interface with reduced clutter.

## [0.1.0] - 2025-09-XX

### 🎨 Theme System
- Multiple color themes (Light: Default, Mint, Sakura, Sunny).
- Dark themes (Default, Purple, Nord, Forest, Rose).
- Theme persistence and proper switching.
- CSS variable-based theme system.

### 🔖 Bookmark System
- Complete bookmark management.
- Visual bookmark bar.
- Add/remove bookmarks functionality.
- Bookmark persistence.

### ⚡ Performance Optimizations
- Memory management improvements.
- Tab hibernation system.
- Garbage collection optimizations.
- Resource usage monitoring.

## [0.0.7] - 2025-08-XX

### 🏗️ Core Architecture
- Enhanced tab management system.
- Improved IPC communication.
- Better state management.
- Module organization improvements.

### 🔧 Functionality Expansion
- Enhanced navigation controls.
- Quick links system.
- Better bookmark integration.
- Improved user interactions.

## [0.0.1] - 2025-07-XX

### 🚀 Initial Release
- Basic Electron browser framework.
- Tab management system.
- Custom title bar with window controls.
- URL navigation and basic browsing.
- Settings foundation.
- Modern UI foundation with CSS styling.

---

### Legend
- 🎨 UI/UX Improvements.
- 🔧 Bug Fixes.
- 🛡️ Security.
- ⚡ Performance.
- 📱 Features.
- 🎯 Enhancements.
- 🔄 System Changes.
- 📦 Build/Deploy.
- 🏗️ Architecture.
- 🚀 New Release.
