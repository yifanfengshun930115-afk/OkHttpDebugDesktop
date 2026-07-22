import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '../shared/ipc.js';

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.stateGet),
  onStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.stateChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.stateChanged, listener);
  },
  clearCaptures: () => ipcRenderer.invoke(IPC_CHANNELS.capturesClear),
  exportJson: () => ipcRenderer.invoke(IPC_CHANNELS.capturesExportJson),
  adbListDevices: () => ipcRenderer.invoke(IPC_CHANNELS.adbListDevices),
  adbReverse: (serial?: string) => ipcRenderer.invoke(IPC_CHANNELS.adbReverse, serial)
};

contextBridge.exposeInMainWorld('okhttpDebug', api);

