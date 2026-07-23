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

## GitHub Actions

The release workflow lives at:

```text
.github/workflows/desktop-packages.yml
```

It builds:

```text
macOS arm64 DMG on macos-latest
macOS x64 DMG on macos-latest
Windows x64 NSIS installer on windows-2022
Linux x64 AppImage and deb on ubuntu-22.04
```

Manual build:

1. Open the repository on GitHub.
2. Go to Actions.
3. Select Desktop Packages.
4. Choose Run workflow on the `tauri-poc` branch.
5. Download the generated artifacts after both jobs finish.

Release build:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag builds all desktop platforms and uploads the DMG/EXE/AppImage/deb
files to the GitHub Release for that tag.

GitHub Actions downloads official Android SDK Platform-Tools with:

```bash
npm run fetch:adb
```

Local release machines can still use an installed Android SDK with:

```bash
npm run prepare:adb
```

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

## Linux

Build on Linux:

```bash
npm run prepare:adb
npm run tauri:package:linux
```

Outputs:

```text
src-tauri/target/release/bundle/appimage/*.AppImage
src-tauri/target/release/bundle/deb/*.deb
```

The GitHub Actions Linux package is built on `ubuntu-22.04` to keep the AppImage
compatible with a wider set of Linux desktops than a newer runner would.
