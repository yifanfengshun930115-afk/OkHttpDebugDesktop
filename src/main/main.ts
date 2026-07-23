import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS } from '../shared/ipc.js';
import { DEFAULT_DEVICE_WS_PORT, DEFAULT_WS_PORT, DEFAULT_WS_PORT_RANGE_END } from '../shared/protocol.js';
import { CaptureLogWriter } from './captureLogWriter.js';
import { CaptureServer } from './captureServer.js';
import { AdbReverseManager } from './adbReverseManager.js';
import { registerIpcHandlers } from './ipcHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let captureServer: CaptureServer | undefined;
let adbReverseManager: AdbReverseManager | undefined;

function broadcastState() {
  if (!captureServer) {
    return;
  }

  const state = captureServer.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.stateChanged, state);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.webContents.once('did-finish-load', () => {
    if (captureServer) {
      win.webContents.send(IPC_CHANNELS.stateChanged, captureServer.getState());
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  const captureLogWriter = new CaptureLogWriter(path.join(app.getPath('userData'), 'logs'));
  captureServer = new CaptureServer(
    DEFAULT_WS_PORT,
    broadcastState,
    DEFAULT_WS_PORT_RANGE_END,
    DEFAULT_DEVICE_WS_PORT,
    captureLogWriter
  );
  adbReverseManager = new AdbReverseManager(() => captureServer?.getReversePorts() ?? {
    serverRunning: false,
    hostPort: DEFAULT_WS_PORT,
    devicePort: DEFAULT_DEVICE_WS_PORT
  }, broadcastState);
  captureServer.setUsbReverseStateProvider(() => adbReverseManager?.getState() ?? {
    enabled: false,
    active: false,
    hostPort: DEFAULT_WS_PORT,
    devicePort: DEFAULT_DEVICE_WS_PORT,
    intervalMs: 0,
    devices: [],
    message: 'USB 自动映射未配置。'
  });
  registerIpcHandlers(captureServer, () => BrowserWindow.getFocusedWindow(), adbReverseManager);
  captureServer.start();
  adbReverseManager.start();
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  adbReverseManager?.stop();
  captureServer?.stop();
});
