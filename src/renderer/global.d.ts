import type { DesktopApi } from '../shared/ipc.js';

declare global {
  interface Window {
    okhttpDebug?: DesktopApi;
    __TAURI_INTERNALS__?: unknown;
  }
}

export {};
