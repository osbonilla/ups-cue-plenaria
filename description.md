# ArcGIS Template App - Project Description

## What this app is
This is a Vite + React + TypeScript web app that renders an ArcGIS 3D scene (`arcgis-scene`) with Calcite UI components and MobX state management.

Primary purpose in current config:
- Display a Vancouver stadium/fire-response themed 3D web scene.
- Provide ArcGIS OAuth sign-in/sign-out.
- Support dark/light UI theme switching.

## Tech stack
- React 19 + ReactDOM 19
- Vite 6
- TypeScript 5
- ArcGIS Map Components (`@arcgis/map-components`)
- Calcite Components (`@esri/calcite-components`)
- ArcGIS Core modules (`@arcgis/core`) via imports in stores/utils
- MobX + mobx-react-lite

## Runtime entry flow
1. `index.html` loads app shell and ArcGIS theme stylesheet link (`id="arcgis-maps-sdk-theme"`).
2. `src/main.tsx` imports global CSS and renders `<App />` into `#root`.
3. `src/components/App/index.tsx` renders:
   - `Navigation`
   - `SceneView`
   - `Identity`
   - `ErrorAlert`
   inside `calcite-shell`.

## Core components
### `SceneView`
File: `src/components/SceneView/index.tsx`

Responsibilities:
- Reads web scene id from URL hash (`#webscene=...`) using `getWebSceneIdFromHashParams()`.
- Falls back to `mapConfig['web-map-id']`.
- Renders `<arcgis-scene item-id={websceneId}>`.
- On `onarcgisViewReadyChange`, stores `view` in MobX state and marks view loaded.
- Writes default `webscene` hash if not present.

### `Navigation`
File: `src/components/Navigation/index.tsx`

Responsibilities:
- Displays title/description from config in `calcite-navigation-logo`.
- Hosts `DarkModeSwitch` and `Identity` controls in top navigation.

### `Identity`
File: `src/components/Identity/index.tsx`

Responsibilities:
- Observes authentication store (`auth.userInfo`).
- Shows `Sign in` button when signed out.
- Shows `calcite-navigation-user` and popover `Sign out` action when signed in.

### `ErrorAlert`
File: `src/components/ErrorAlert/index.tsx`

Responsibilities:
- Displays Calcite danger alert when `state.error` is populated.

### `DarkModeSwitch`
File: `src/components/DarkModeSwitch/index.tsx`

Responsibilities:
- Toggles `calcite-mode-dark` / `calcite-mode-light` classes on `body` and ArcGIS widget containers.
- Dynamically swaps ArcGIS SDK theme stylesheet URL via `<link id="arcgis-maps-sdk-theme">`.

## State management (MobX)
### Global UI/scene state store
File: `src/stores/state.ts`

Observable state includes:
- View lifecycle: `viewLoaded`, `sceneView`
- Error object: `error`

### Authentication store
File: `src/stores/authentication.ts`

Responsibilities:
- Registers ArcGIS `OAuthInfo` with `IdentityManager` at startup.
- Checks existing sign-in and loads `Portal` user profile.
- Exposes `signIn()` and `signOut()`.
- `signOut()` destroys credentials and reloads page.

Config consumed:
- `portalUrl`
- `applicationId`

## App configuration
File: `src/config.ts`

Important values:
- `mapConfig['web-map-id'] = 'b6425184350f4c5fbfd156bcbde70bb9'`
- `portalUrl = 'https://3dgis.maps.arcgis.com/'`
- `applicationTitle = 'Vancouver Stadium'`
- `applicationDescription = 'Vancouver Fire Response Service'`
- `applicationId = 'LTMUaLlOET1HAbbj'`

`mapConfig` also includes basemap, center, scale, zoom, popup/rotation defaults (not all currently used by `SceneView`, which relies on `item-id`).

## Utility modules
### URL hash helper
File: `src/utils/URLHashParams.ts`
- Manages `#webscene=<id>` parameter.
- Supports get/set helpers for scene id persistence/shareable URL.

### Generic helpers
File: `src/utils/index.ts`
- `fadeIn(layer)`
- number/date formatting helpers

## Styling/layout
- `src/main.css` sets global sizing, Calcite-based theme variables, typography baseline, and scrollbar styles.
- `src/components/App/App.css` ensures `html`, `body`, `#root`, and `calcite-shell` fill full viewport.

## Build/run/deploy
From `package.json` + `README.md`:
- Dev server: `npm run dev` (Vite on port 3000 from `vite.config.js`)
- Build: `npm run build`
- Preview: `npm run serve`
- Postbuild copies Calcite assets into `dist/assets`

Vite config notes:
- `base: './'` (relative asset paths, suitable for subpath/static hosting)
- `server.port: 3000`

## Known inconsistencies / things to watch
1. ArcGIS theme version mismatch:
- `index.html` uses ArcGIS theme CSS `4.33`.
- `DarkModeSwitch` toggles theme URLs at `4.32`.
This can cause style mismatches after toggle.

2. Duplicate `Identity` rendering:
- `Identity` appears in both `Navigation` and `App` root composition.
Likely unintended; can produce duplicate sign-in/user controls.

3. Potential stale hash params behavior:
- `hashParams` is created once at module load in `URLHashParams.ts`.
If hash changes externally after load, helper may not reflect it unless reloaded.

4. Some config fields not actively used by scene initialization:
- `mapConfig.basemap/center/zoom/scale/...` are defined but current `SceneView` path uses `item-id` web scene.

## Extension points (where to change what)
- Change default web scene/app identity text/OAuth app:
  - `src/config.ts`
- Add new scene controls/effects:
  - UI: `src/components/Navigation` or new component
  - state: `src/stores/state.ts`
  - effect wiring: `src/components/SceneView/index.tsx`
  - implementation: `src/utils/*`
- Adjust auth behavior:
  - `src/stores/authentication.ts`
- Adjust metadata and social preview:
  - `index.html`

## Fast mental model
- React composes UI shell.
- ArcGIS web component owns the 3D view.
- MobX store is the switchboard for scene/runtime toggles.
- Utility modules perform low-level ArcGIS layer/view mutations.
- Config file centralizes scene id, portal, OAuth app id, and displayed title/description.
