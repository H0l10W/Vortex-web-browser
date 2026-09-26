# Browser interface

These changes are in the working source after 0.5.0.

- **Browser menu:** The three-dot button contains quick settings for page zoom, the bookmarks bar, dark web content, ad blocking, and tracker blocking. Labeled actions provide bookmarks, downloads, history, updates, All settings, and Customize toolbar. The separate quick-settings button has been removed. Optional toolbar shortcuts move into this menu when the window is narrow.
- **Find tabs:** Use the search button in the title bar or `Ctrl+Shift+A`. Search titles, addresses, and group names. Arrow keys choose a result; Enter switches to it. The same panel contains the Vertical tabs preference. Horizontal tabs scroll instead of shrinking indefinitely.
- **Address bar:** Results distinguish websites, searches, history, bookmarks, quick links, and Switch to tab actions. Open-tab results switch to the existing tab instead of navigating the current tab. Incognito tab suggestions stay within the active tab's privacy mode.
- **Settings search:** Search at the top of Settings, then choose a result to open its category and focus the control. Direct label matches rank first. Clear or Escape returns to the selected category.
- **Downloads:** The toolbar download button shows active progress. Its panel lists the five most recent downloads with file status and size. Show in folder reveals a completed file; View all downloads opens the full history. Download resumption is not part of this update.
- **Profiles:** The profile button shows the active name when space permits. Its panel lists profiles and explains that switching restarts Vortex. Switch and restart saves the current normal session before switching. Profile creation remains available in General settings.
- **New tab:** Customize selects Minimal or Information rich, places widgets above or below quick links, changes which widget comes first, and reorders quick links with Move up and Move down. Individual widget visibility remains in Widgets settings, linked from the customizer.
- **Workspaces:** The title-bar workspace button saves a named snapshot of up to 200 website tabs in the current window. Open tabs adds the saved set to the current window and preserves its groups. Update replaces a saved snapshot with the current set. Names are editable and Delete offers Undo. Up to 50 workspaces are stored in the active profile. Incognito and internal pages are excluded; workspaces are unavailable in incognito windows.

New dialogs support Escape, keyboard focus containment, and focus return to their launch controls. Tabs and quick links can be reached and used with the keyboard. Appearance preferences are stored in the active browser profile.

## Validation

`npm run check` runs lint and the existing security audit. `npm run workspace:test` checks snapshot privacy and validation. `npm run ui:test` runs the actual Electron UI with disposable workspace-local data, deterministic local test pages, screenshots, and a JSON report. The UI suite covers toolbar controls, tab search and switching, workspace actions, profile discovery, downloads, settings search, quick-link ordering, persistence, and narrow/scaled layouts.
