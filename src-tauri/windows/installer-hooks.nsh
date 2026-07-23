!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$LOCALAPPDATA\com.gzq.okhttpdebug.tauri"
  RMDir /r "$APPDATA\com.gzq.okhttpdebug.tauri"
  RMDir /r "$LOCALAPPDATA\OkHttp Debug Desktop"
  RMDir /r "$APPDATA\OkHttp Debug Desktop"
  RMDir /r "$LOCALAPPDATA\tauri\com.gzq.okhttpdebug.tauri"
  RMDir /r "$APPDATA\tauri\com.gzq.okhttpdebug.tauri"
  RMDir /r "$TEMP\okhttp-debug-desktop-tauri"
!macroend
