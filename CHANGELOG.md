# Vortex Browser - Changelog

## [0.3.1] - 2025-12-09

### ✨ New Features & Fixes
- **All Settings Now Functional**: Every setting in the browser now works and applies to both the browser UI and webpages as intended
- **Tab Behavior Settings**: 'Close All Tabs on Exit' and 'Show Tab Previews' now work correctly
- **Zoom, Images, JavaScript, Popups**: All browser and webpage settings apply instantly and persist across sessions
- **Smooth Scrolling & Animations**: UI and webpage settings for scrolling and animations are now fully applied
- **Robust Tab Restoration**: Improved tab restoration logic and error handling after restart

### 🐛 Bug Fixes
- Fixed: Settings page and tabs failing to load after restart
- Fixed: Tab previews toggle now updates tab display instantly
- Fixed: Close tabs on exit now clears session tabs as expected
- Fixed: All settings now persist and apply correctly

### 🛠️ Technical Changes
- Improved IPC and settings communication
- Enhanced tab rendering logic for previews
- Better persistent storage and session management

---

## [0.3.0] - 2025-12-08

### ✨ New Features
- **Modern Settings Interface**: Complete redesign with card-based layout and organized sections
- **Download Folder Picker**: Native system dialog for choosing download location
- **Enhanced Tab Management**: Improved tab restoration after browser restart
- **Smart Sidebar Positioning**: Settings sidebar now properly avoids blocking browser controls

### 🐛 Bug Fixes
- **Fixed Tab Refresh Issue**: Tabs no longer refresh unnecessarily when closing other tabs
- **Fixed Settings Tab Persistence**: Settings page now maintains state when switching between tabs
- **Fixed Sidebar Overlap**: Resolved issue where settings sidebar blocked browser navigation
- **Fixed Weather Widget**: Enhanced dual API fallback system with improved error handling and timeouts

### 🔧 Improvements
- **Code Cleanup**: Removed debug logs and unused files for better performance
- **CSS Optimization**: Consolidated theme styles and simplified selectors
- **Memory Management**: Improved garbage collection and tab hibernation
- **UI Polish**: Better spacing, modern controls, and responsive design

### 🛠️ Technical Changes
- Enhanced IPC communication for settings management
- Improved view lifecycle management for Electron BrowserViews
- Streamlined auto-updater configuration
- Better persistent storage integration

---

## [0.2.2] - 2025-12-07

### 🎨 Major UI Modernization
- **Chrome-like floating tabs**: Complete redesign with overlapping tabs, rounded corners, and shadows
- **Enhanced tab system**: Increased tab height from 34px to 38px for better visual presence
- **Improved spacing**: Better tab positioning with optimized add button placement
- **Professional shadows**: Added subtle shadows to floating tabs for depth and modern appearance

### 🔧 Positioning & Layout Fixes
- **Fixed webview positioning**: Resolved issues where webpage content overlapped URL bar and controls
- **Accurate header calculations**: Precise height calculations (129px with bookmarks, 92px without)
- **Bookmark bar auto-hiding**: Fixed positioning when bookmark bar shows/hides dynamically
- **Settings page improvements**: Reduced gaps and improved layout spacing

### 🎯 Window Controls Enhancement
- **Consistent theming**: Window controls maintain gray appearance across all color themes
- **Red close button**: Close button shows red background on hover regardless of theme
- **Rounded controls**: Added 6px border radius to window control buttons
- **Proper spacing**: Moved close button away from window edge with padding

### 🛠️ Technical Improvements
- **Theme isolation**: Comprehensive CSS overrides to prevent theme interference
- **Code organization**: Fixed syntax errors and improved CSS structure
- **Performance optimization**: Better rendering and reduced style conflicts

## [0.2.1] - 2025-11-XX

### 🔄 Auto-Updater System
- Complete implementation of electron-updater
- GitHub releases integration
- Professional notification system with progress tracking
- One-click update installation with app restart
- Smart notification management with cooldown systems

### 🎯 Icon & Branding
- Custom application icon implementation
- Proper icon embedding in executable
- Fixed icon caching issues

### 📦 Build System
- ASAR packaging enabled for security
- Automated publishing pipeline
- GitHub repository configuration for releases

## [0.2.0] - 2025-10-XX

### 🛡️ Major Security Overhaul
- Re-enabled Chromium sandbox for enhanced security
- HTTPS enforcement with automatic HTTP to HTTPS conversion
- Enhanced Content Security Policy (CSP)
- Certificate validation and error handling

### 📱 Widget System Enhancement
- **Weather Widget**: Manual location input, geocoding integration
- **News Widget**: Multi-country support, category filtering
- Better error handling and fallback mechanisms

### 🎛️ Settings System Redesign
- Complete UI redesign with modern card layouts
- Organized sections (Appearance, Privacy, About)
- Enhanced theme selector
- Cleaner interface with reduced clutter

## [0.1.0] - 2025-09-XX

### 🎨 Theme System
- Multiple color themes (Light: Default, Mint, Sakura, Sunny)
- Dark themes (Default, Purple, Nord, Forest, Rose)
- Theme persistence and proper switching
- CSS variable-based theme system

### 🔖 Bookmark System
- Complete bookmark management
- Visual bookmark bar
- Add/remove bookmarks functionality
- Bookmark persistence

### ⚡ Performance Optimizations
- Memory management improvements
- Tab hibernation system
- Garbage collection optimizations
- Resource usage monitoring

## [0.0.7] - 2025-08-XX

### 🏗️ Core Architecture
- Enhanced tab management system
- Improved IPC communication
- Better state management
- Module organization improvements

### 🔧 Functionality Expansion
- Enhanced navigation controls
- Quick links system
- Better bookmark integration
- Improved user interactions

## [0.0.1] - 2025-07-XX

### 🚀 Initial Release
- Basic Electron browser framework
- Tab management system
- Custom title bar with window controls
- URL navigation and basic browsing
- Settings foundation
- Modern UI foundation with CSS styling

---

### Legend
- 🎨 UI/UX Improvements
- 🔧 Bug Fixes
- 🛡️ Security
- ⚡ Performance
- 📱 Features
- 🎯 Enhancements
- 🔄 System Changes
- 📦 Build/Deploy
- 🏗️ Architecture
- 🚀 New Release