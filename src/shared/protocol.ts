export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_WS_PORT = 19090;
export const DEFAULT_DEVICE_WS_PORT = 19090;
export const DEFAULT_WS_PORT_RANGE_END = 19109;

export type ProtocolMessageType = 'hello' | 'capture' | 'ping' | 'pong';

export type HeaderValue = string | string[];
export type HeadersRecord = Record<string, HeaderValue>;
export type CaptureStage = string;

export interface AndroidAppInfo {
  packageName: string;
  versionName: string;
  versionCode?: number | string;
  debuggable?: boolean;
}

export interface AndroidDeviceInfo {
  manufacturer?: string;
  model?: string;
  sdkInt?: number;
  deviceTag?: string;
}

export interface HelloMessage {
  type: 'hello';
  protocolVersion: typeof PROTOCOL_VERSION;
  app: AndroidAppInfo;
  device: AndroidDeviceInfo;
  clientTag?: string;
}

export interface HttpPayload {
  method: string;
  url: string;
  headers: HeadersRecord;
  body?: string;
  bodyTruncated?: boolean;
  contentType?: string;
  contentLength?: number;
}

export interface HttpResponsePayload {
  code: number;
  message: string;
  headers: HeadersRecord;
  body?: string;
  bodyTruncated?: boolean;
  contentType?: string;
  contentLength?: number;
}

export interface CaptureErrorPayload {
  type: string;
  message: string;
  stack?: string;
}

export type JsonObject = Record<string, unknown>;

export interface CaptureMessage {
  type: 'capture';
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  startedAtEpochMs: number;
  groupId: string;
  stage: CaptureStage;
  durationMs?: number;
  request: HttpPayload;
  response?: HttpResponsePayload;
  error?: CaptureErrorPayload;
  timing?: JsonObject;
}

export interface PingMessage {
  type: 'ping';
  protocolVersion?: typeof PROTOCOL_VERSION;
  sentAtEpochMs?: number;
}

export interface PongMessage {
  type: 'pong';
  protocolVersion?: typeof PROTOCOL_VERSION;
  sentAtEpochMs?: number;
  receivedAtEpochMs?: number;
}

export interface HelloAckMessage {
  type: 'hello_ack';
  protocolVersion: typeof PROTOCOL_VERSION;
  server: 'OkHttp Debug Desktop';
  serverTimeEpochMs: number;
}

export type AndroidToDesktopMessage = HelloMessage | CaptureMessage | PingMessage | PongMessage;
export type DesktopToAndroidMessage = HelloAckMessage | PongMessage;

export interface CaptureRecord extends CaptureMessage {
  connectionId?: string;
  receivedAtEpochMs: number;
  source?: {
    app?: AndroidAppInfo;
    device?: AndroidDeviceInfo;
    clientTag?: string;
  };
}

export interface ConnectionInfo {
  id: string;
  connectedAtEpochMs: number;
  lastSeenAtEpochMs: number;
  remoteAddress?: string;
  app?: AndroidAppInfo;
  device?: AndroidDeviceInfo;
  protocolVersion?: number;
  clientTag?: string;
}

export interface ServerState {
  port: number;
  preferredPort: number;
  devicePort: number;
  usbReverse: UsbReverseState;
  captureLogPath?: string;
  portRange: {
    start: number;
    end: number;
  };
  running: boolean;
  starting?: boolean;
  error?: string;
  connectionCount: number;
  connections: ConnectionInfo[];
}

export interface DesktopState {
  server: ServerState;
  captures: CaptureRecord[];
}

export interface ExportResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  count?: number;
  openFolderError?: string;
  error?: string;
}

export interface LogActionResult {
  ok: boolean;
  message: string;
  logDir?: string;
  captureLogPath?: string;
  deletedCount?: number;
  error?: string;
}

export interface LogFileInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedEpochMs?: number;
}

export interface DiagnosticsInfo {
  generatedAtEpochMs: number;
  appVersion: string;
  os: string;
  arch: string;
  logDir: string;
  captureLogPath?: string;
  server: ServerState;
  adb: AdbInfo;
  logFiles: LogFileInfo[];
}

export interface UpdateCheckResult {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  releaseUrl: string;
  assetName?: string;
  assetDownloadUrl?: string;
  assetSizeBytes?: number;
  checkedAtEpochMs: number;
  message: string;
  error?: string;
}

export interface ExternalOpenResult {
  ok: boolean;
  message: string;
  error?: string;
}

export type UpdateInstallStage = 'downloading' | 'downloaded' | 'installing';

export interface UpdateInstallProgress {
  stage: UpdateInstallStage;
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
  message: string;
  filePath?: string;
}

export interface UpdateInstallResult {
  ok: boolean;
  message: string;
  filePath?: string;
  error?: string;
}

export interface AdbDevice {
  serial: string;
  state: string;
  description: string;
}

export interface AdbInfo {
  available: boolean;
  path?: string;
  source?: string;
  version?: string;
  checkedPaths: string[];
  installHint: string;
}

export interface AdbCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  devices?: AdbDevice[];
  adb?: AdbInfo;
}

export interface UsbReverseDeviceState {
  serial: string;
  state: string;
  description: string;
  mapped: boolean;
  lastAttemptEpochMs: number;
  error?: string;
  stderr?: string;
}

export interface UsbReverseState {
  enabled: boolean;
  active: boolean;
  hostPort: number;
  devicePort: number;
  intervalMs: number;
  lastAttemptEpochMs?: number;
  lastSuccessEpochMs?: number;
  adb?: AdbInfo;
  devices: UsbReverseDeviceState[];
  message?: string;
  error?: string;
}
