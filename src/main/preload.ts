import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('okhttpDebug', {
  version: '0.1.0'
});

