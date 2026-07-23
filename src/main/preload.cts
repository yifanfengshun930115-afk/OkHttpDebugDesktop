declare const require: (moduleName: string) => {
  contextBridge: Electron.ContextBridge;
  ipcRenderer: Electron.IpcRenderer;
};

const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  stateGet: 'okhttp-debug:state:get',
  stateChanged: 'okhttp-debug:state:changed',
  capturesClear: 'okhttp-debug:captures:clear',
  capturesExportJson: 'okhttp-debug:captures:export-json',
  adbListDevices: 'okhttp-debug:adb:list-devices',
  adbReverse: 'okhttp-debug:adb:reverse'
} as const;

const api = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.stateGet),
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.stateChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.stateChanged, listener);
  },
  clearCaptures: () => ipcRenderer.invoke(IPC_CHANNELS.capturesClear),
  exportJson: () => ipcRenderer.invoke(IPC_CHANNELS.capturesExportJson),
  adbListDevices: () => ipcRenderer.invoke(IPC_CHANNELS.adbListDevices),
  adbReverse: (serial?: string, hostPort?: number, devicePort?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.adbReverse, serial, hostPort, devicePort)
};

contextBridge.exposeInMainWorld('okhttpDebug', api);
