# OkHttp Debug Desktop

Cross-platform Electron desktop console for receiving Android OkHttp debug captures over a local WebSocket server.

## Plan

1. Scaffold the Electron + React + TypeScript + Vite project and keep the initial app bootable.
2. Implement protocol types, the main-process WebSocket server, IPC bridge, capture storage, session clearing, JSON export, and adb helpers.
3. Build the renderer debugger UI with compact request list, filters, details tabs, connection controls, and OneNews-inspired sample captures.
4. Add packaging documentation and electron-builder targets for Windows, macOS, and Linux, then verify with `npm run build`.

