import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DesktopApi } from '../shared/ipc.js';
import type { AdbCommandResult, DesktopState, ExportResult } from '../shared/protocol.js';

const STATE_CHANGED_EVENT = 'state_changed';

const tauriApi: DesktopApi = {
  getState: () => invoke<DesktopState>('get_state'),
  onStateChanged: (callback: (state: DesktopState) => void) => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<DesktopState>(STATE_CHANGED_EVENT, (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },
  clearCaptures: () => invoke<DesktopState>('clear_captures'),
  exportJson: () => invoke<ExportResult>('export_json'),
  adbListDevices: () => invoke<AdbCommandResult>('adb_list_devices'),
  adbReverse: (serial?: string, hostPort?: number, devicePort?: number) =>
    invoke<AdbCommandResult>('adb_reverse', { serial, hostPort, devicePort })
};

function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export function resolveDesktopApi(): DesktopApi | undefined {
  if (window.okhttpDebug) {
    return window.okhttpDebug;
  }
  return isTauriRuntime() ? tauriApi : undefined;
}
