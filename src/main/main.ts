import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS } from '../shared/ipc.js';
import { DEFAULT_WS_PORT } from '../shared/protocol.js';
import { CaptureServer } from './captureServer.js';
import { registerIpcHandlers } from './ipcHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function broadcastState() {
  const state = captureServer.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.stateChanged, state);
  }
}

const captureServer = new CaptureServer(DEFAULT_WS_PORT, broadcastState);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.webContents.once('did-finish-load', () => {
    win.webContents.send(IPC_CHANNELS.stateChanged, captureServer.getState());
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(captureServer, () => BrowserWindow.getFocusedWindow());
  captureServer.start();
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
  captureServer.stop();
});
