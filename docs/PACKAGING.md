# Packaging

This project currently ships the Tauri desktop app. The old Electron packaging
scripts are still present for comparison, but product packages should use the
`tauri:package:*` scripts below.

## Speed

Tauri packaging uses `npm run build:renderer:if-stale` as its frontend build
step. The script checks the renderer source, shared source, Vite/TypeScript
config, and package files against `dist/index.html`.

If nothing changed, it skips `tsc` and `vite build`, which removes the most
common repeated packaging cost.

Windows NSIS packages use `zlib` compression. This is faster than the default
LZMA compression and keeps the installer reasonably small.

Tauri bundler tools are cached under `src-tauri/target/.tauri` through
`bundle.useLocalToolsDir`, so repeat packaging does not need to download tools
again on the same release machine.

## macOS

Build on macOS:

```bash
npm run prepare:adb
npm run tauri:package:mac
```

Outputs:

```text
src-tauri/target/release/bundle/macos/OkHttp Debug Desktop.app
src-tauri/target/release/bundle/dmg/*.dmg
```

The DMG flow does not provide a system uninstall hook. For a clean uninstall,
remove the app from `/Applications`, then run:

```bash
scripts/uninstall-macos-cleanup.sh
```

That script removes the app log directory, application support directory,
WebView cache directories, HTTP storage, saved window state, and temporary
desktop debug data.

## Windows

Build on Windows:

```powershell
npm run prepare:adb
npm run tauri:package:windows
```

Output:

```text
src-tauri\target\release\bundle\nsis\*.exe
```

The Windows package is an NSIS installer. Its uninstall hook is defined in:

```text
src-tauri/windows/installer-hooks.nsh
```

On uninstall, it removes:

```text
%LOCALAPPDATA%\com.gzq.okhttpdebug.tauri
%APPDATA%\com.gzq.okhttpdebug.tauri
%LOCALAPPDATA%\OkHttp Debug Desktop
%APPDATA%\OkHttp Debug Desktop
%LOCALAPPDATA%\tauri\com.gzq.okhttpdebug.tauri
%APPDATA%\tauri\com.gzq.okhttpdebug.tauri
%TEMP%\okhttp-debug-desktop-tauri
```

Windows packages should be produced on a Windows release machine or Windows CI
runner. The macOS Tauri CLI can build macOS bundles here, but this machine does
not have the Windows NSIS/MSVC packaging toolchain installed.
