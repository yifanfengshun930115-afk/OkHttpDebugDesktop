# OkHttp Debug Desktop

Cross-platform Tauri desktop console for receiving Android OkHttp debug captures over a local WebSocket server.

## Features

- Receives Android OkHttp captures over WebSocket.
- Supports paired plain/wire request stages for encrypted API debugging.
- Automatically manages `adb reverse` for USB debugging.
- Stores local capture/runtime logs with 7-day retention.
- Builds macOS, Windows, and Linux desktop packages through GitHub Actions.

## Run

```bash
npm install
npm run tauri:dev
```

The desktop app listens on `ws://127.0.0.1:19090/session?token=<token>`. For USB debugging, connect a device and run the built-in Reverse button, or run:

```bash
adb reverse tcp:19090 tcp:19090
```

If `19090` is busy, the app automatically tries `19091` through `19109`. USB clients can still keep the Android-side port fixed at `19090`; the built-in USB repair action maps `tcp:19090` on the device to the actual desktop port.

The server binds to `127.0.0.1` only. These high, non-privileged ports avoid OS-reserved ranges and are not exposed to the LAN in USB mode.

ADB can be bundled for product builds or discovered from `ADB_PATH`, Android SDK environment variables, Android Studio default SDK paths, and `PATH`. See [docs/ADB.md](docs/ADB.md).

For runtime logs and issue reports, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Build

```bash
npm run prepare:adb
npm run tauri:package:mac
```

GitHub Actions can produce:

- Windows: NSIS installer.
- macOS: arm64 and x64 DMG.
- Linux: AppImage and deb.

See [docs/PACKAGING.md](docs/PACKAGING.md).

The renderer includes OneNews-inspired sample captures for `NEWS_API`, `WEATHER_API`, `api.waqi.info`, and `BILLING_API`, with tokens redacted.
