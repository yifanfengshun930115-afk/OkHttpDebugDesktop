# ADB Strategy

The desktop app can work with either a bundled `adb` binary or a user-installed
Android SDK Platform-Tools installation.

## Discovery Order

1. `ADB_PATH`
2. Bundled `resources/platform-tools/<platform>/adb`
3. `ANDROID_HOME/platform-tools/adb`
4. `ANDROID_SDK_ROOT/platform-tools/adb`
5. Common Android Studio SDK locations
6. `adb` from `PATH`

## Bundling

For product builds, run this on each release machine before Tauri packaging:

```bash
npm run prepare:adb
```

GitHub Actions uses the official Google Platform-Tools download instead:

```bash
npm run fetch:adb
```

The script finds the local Android SDK Platform-Tools directory and copies it to
the current platform resource folder. You can also place platform-tools binaries
manually under:

```text
resources/platform-tools/darwin-arm64/adb
resources/platform-tools/darwin-x64/adb
resources/platform-tools/linux-x64/adb
resources/platform-tools/win32/adb.exe
```

The Tauri bundler copies that folder into app resources. Keep each binary from
the official Android SDK Platform-Tools package and preserve the accompanying
license files when shipping a public build.

The copied binaries are ignored by git. Treat them as release artifacts, not
source files.

## User Install Fallback

If ADB is not bundled, tell users to install Android SDK Platform-Tools through
Android Studio SDK Manager or the official standalone Platform-Tools package,
then set one of:

```bash
export ADB_PATH=/absolute/path/to/adb
export ANDROID_HOME=/absolute/path/to/android/sdk
```

## Port Mapping

The Android SDK defaults to:

```text
ws://127.0.0.1:19090/session
```

The desktop app prefers `127.0.0.1:19090`, but if that port is busy it tries
`19091` through `19109`. USB debugging keeps the Android device port fixed at
`19090` and maps it to the actual desktop port:

```bash
adb reverse tcp:19090 tcp:<desktop-port>
```

The desktop listener is bound to `127.0.0.1` in USB mode, so this port range is
not exposed to other LAN devices. If every port in `19090-19109` is occupied,
the UI reports the failure and the user should close the conflicting local
process or configure a different future range before starting the server.
