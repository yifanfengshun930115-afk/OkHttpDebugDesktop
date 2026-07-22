import type { AdbCommandResult, DesktopState, ExportResult } from './protocol.js';

export const IPC_CHANNELS = {
  stateGet: 'okhttp-debug:state:get',
  stateChanged: 'okhttp-debug:state:changed',
  capturesClear: 'okhttp-debug:captures:clear',
  capturesExportJson: 'okhttp-debug:captures:export-json',
  adbListDevices: 'okhttp-debug:adb:list-devices',
  adbReverse: 'okhttp-debug:adb:reverse'
} as const;

export interface DesktopApi {
  getState(): Promise<DesktopState>;
  onStateChanged(callback: (state: DesktopState) => void): () => void;
  clearCaptures(): Promise<DesktopState>;
  exportJson(): Promise<ExportResult>;
  adbListDevices(): Promise<AdbCommandResult>;
  adbReverse(serial?: string, hostPort?: number, devicePort?: number): Promise<AdbCommandResult>;
}
