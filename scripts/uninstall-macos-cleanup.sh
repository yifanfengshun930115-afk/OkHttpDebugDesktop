#!/bin/sh
set -eu

APP_ID="com.gzq.okhttpdebug.tauri"
APP_NAME="OkHttp Debug Desktop"

for path in \
  "$HOME/Library/Logs/$APP_ID" \
  "$HOME/Library/Application Support/$APP_ID" \
  "$HOME/Library/Caches/$APP_ID" \
  "$HOME/Library/WebKit/$APP_ID" \
  "$HOME/Library/HTTPStorages/$APP_ID" \
  "$HOME/Library/Saved Application State/$APP_ID.savedState" \
  "${TMPDIR:-/tmp}/okhttp-debug-desktop-tauri" \
  "${TMPDIR:-/tmp}/$APP_NAME"
do
  if [ -e "$path" ]; then
    rm -R "$path"
    echo "Removed $path"
  fi
done

echo "Clean uninstall data removal complete for $APP_NAME."
