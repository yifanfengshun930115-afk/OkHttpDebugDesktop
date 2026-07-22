Place optional Android SDK Platform-Tools binaries here for bundled ADB builds.
Run `npm run prepare:adb` to copy the current machine's Platform-Tools into the
correct subdirectory before packaging.

Expected layout:

- darwin-arm64/adb
- darwin-x64/adb
- linux-x64/adb
- linux-arm64/adb
- win32/adb.exe

The desktop app also searches ADB_PATH, ANDROID_HOME, ANDROID_SDK_ROOT, common
Android Studio SDK locations, and PATH.
