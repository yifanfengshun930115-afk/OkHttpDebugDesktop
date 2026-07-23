import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DesktopApi } from '../shared/ipc.js';
import type { AdbCommandResult, DesktopState, DiagnosticsInfo, ExportResult, LogActionResult } from '../shared/protocol.js';

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
  openLogDir: () => invoke<LogActionResult>('open_log_dir'),
  clearLogs: () => invoke<LogActionResult>('clear_logs'),
  getDiagnostics: () => invoke<DiagnosticsInfo>('get_diagnostics'),
  reportRendererError: (payload) => invoke<LogActionResult>('report_renderer_error', { payload }),
  adbListDevices: () => invoke<AdbCommandResult>('adb_list_devices'),
  adbReverse: (serial?: string, hostPort?: number, devicePort?: number) =>
    invoke<AdbCommandResult>('adb_reverse', { serial, hostPort, devicePort })
};

export function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export function resolveDesktopApi(): DesktopApi | undefined {
  if (window.okhttpDebug) {
    return window.okhttpDebug;
  }
  return isTauriRuntime() ? tauriApi : undefined;
}

export function onDesktopCloseRequested(callback: () => void): () => void {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  let disposed = false;
  let unlisten: (() => void) | undefined;
  void getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    callback();
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
}

export async function minimizeDesktopWindow() {
  if (isTauriRuntime()) {
    await getCurrentWindow().minimize();
  }
}

export function closeTauriApp(devicePort?: number): Promise<void> {
  if (!isTauriRuntime()) {
    return Promise.resolve();
  }
  return invoke<void>('close_app', { devicePort });
}

export function cleanupTauriAdbReverse(devicePort?: number): Promise<AdbCommandResult> {
  if (!isTauriRuntime()) {
    return Promise.resolve({
      ok: true,
      stdout: '',
      stderr: '',
      devices: []
    });
  }
  return invoke<AdbCommandResult>('cleanup_adb_reverse', { devicePort });
}
