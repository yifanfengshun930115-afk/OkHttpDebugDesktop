import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { IPC_CHANNELS } from '../shared/ipc.js';
import { PROTOCOL_VERSION, type ExportResult } from '../shared/protocol.js';
import { listAdbDevices, reverseDebugPort } from './adb.js';
import type { CaptureServer } from './captureServer.js';

function exportFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `okhttp-captures-${stamp}.json`;
}

export function registerIpcHandlers(server: CaptureServer, getFocusedWindow: () => BrowserWindow | null) {
  ipcMain.handle(IPC_CHANNELS.stateGet, () => server.getState());
  ipcMain.handle(IPC_CHANNELS.capturesClear, () => server.clearCaptures());

  ipcMain.handle(IPC_CHANNELS.capturesExportJson, async (): Promise<ExportResult> => {
    try {
      const state = server.getState();
      const window = getFocusedWindow();
      const options = {
        title: 'Export captures as JSON',
        defaultPath: exportFileName(),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      };
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);

      if (canceled || !filePath) {
        return { ok: false, canceled: true };
      }

      await writeFile(
        filePath,
        JSON.stringify(
          {
            exportedAtEpochMs: Date.now(),
            protocolVersion: PROTOCOL_VERSION,
            server: state.server,
            captures: state.captures
          },
          null,
          2
        ),
        'utf8'
      );

      return { ok: true, filePath, count: state.captures.length };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown export error.'
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.adbListDevices, () => listAdbDevices());
  ipcMain.handle(IPC_CHANNELS.adbReverse, (_event, serial?: string, hostPort?: number, devicePort?: number) =>
    reverseDebugPort(serial, hostPort, devicePort)
  );
}
