# Mobile: PWA and Expo app

## Progressive Web App

- Manifest: `/manifest.webmanifest` (standalone, dark theme, maskable icons, shortcuts to Emergency and Radar).
- Service worker: `/sw.js` (offline fallback page `/offline`, Web Push display and click-through).
- Install: the **Install** page explains per platform. iOS requires Add to Home Screen before push works (iOS 16.4+).
- Web Push needs VAPID keys on the API; without them the UI says "not configured" and other channels still work.

## Expo companion (`apps/mobile`)

Read-only readiness, alerts and rescue receipts for a watched address, using the typed SDK against the API. It holds no
keys; signing actions open the web app in the browser where the user's wallet signs. Background push for the mobile app
is not implemented yet. See `apps/mobile/README.md` to run it.
