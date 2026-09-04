# Source layout

`main.js` and the HTML pages remain at the project root as Electron and local
page entry points. Application JavaScript belongs under this directory.

- `renderer/` contains the browser-window entry point, UI services, and controllers.
- `renderer/widgets/` contains independent new-tab widgets.
- `settings/` contains the full-settings entry point, services, and feature controllers.
- `history/` contains the browsing-history page controller.
- `preload/` contains privileged context-bridge entry points.
- `suggestions/` contains the address-bar suggestion overlay scripts.

New modules should expose a small public API, avoid hidden cross-module state,
and receive dependencies as arguments or through an explicit shared service.
