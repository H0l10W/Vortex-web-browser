# Source layout

Root-level JavaScript and HTML files are Electron entry points retained for
packaging compatibility. Reusable feature code belongs under this directory.

- `renderer/` contains browser-window UI services and controllers.
- `renderer/widgets/` contains independent new-tab widgets.
- `settings/` contains full-settings page services and feature controllers.

New modules should expose a small public API, avoid hidden cross-module state,
and receive dependencies as arguments or through an explicit shared service.
