# OkHttp Debug Desktop

Cross-platform Electron desktop console for receiving Android OkHttp debug captures over a local WebSocket server.

## Plan

1. Scaffold the Electron + React + TypeScript + Vite project and keep the initial app bootable.
2. Implement protocol types, the main-process WebSocket server, IPC bridge, capture storage, session clearing, JSON export, and adb helpers.
3. Build the renderer debugger UI with compact request list, filters, details tabs, connection controls, and OneNews-inspired sample captures.
4. Add packaging documentation and electron-builder targets for Windows, macOS, and Linux, then verify with `npm run build`.

## Run

```bash
npm install
npm run dev
```

The desktop app listens on `ws://127.0.0.1:19090/session?token=<token>`. For USB debugging, connect a device and run the built-in Reverse button, or run:

```bash
adb reverse tcp:19090 tcp:19090
```

## Build

```bash
npm run build
npm run dist
```

`electron-builder` is configured for:

- Windows: NSIS installer, portable executable, zip.
- macOS: dmg and zip.
- Linux: AppImage, deb, rpm, tar.gz.

The renderer includes OneNews-inspired sample captures for `NEWS_API`, `WEATHER_API`, `api.waqi.info`, and `BILLING_API`, with tokens redacted.
