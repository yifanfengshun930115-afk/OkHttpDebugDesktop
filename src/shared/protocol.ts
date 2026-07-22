export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_WS_PORT = 19090;

export type ProtocolMessageType = 'hello' | 'capture' | 'ping' | 'pong';

export type HeaderValue = string | string[];
export type HeadersRecord = Record<string, HeaderValue>;

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
}

export interface HelloMessage {
  type: 'hello';
  protocolVersion: typeof PROTOCOL_VERSION;
  app: AndroidAppInfo;
  device: AndroidDeviceInfo;
  sessionId: string;
  token?: string;
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
  sessionId: string;
  startedAtEpochMs: number;
  durationMs?: number;
  request: HttpPayload;
  response?: HttpResponsePayload;
  error?: CaptureErrorPayload;
  timing?: JsonObject;
  tags?: JsonObject;
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
  };
}

export interface ConnectionInfo {
  id: string;
  connectedAtEpochMs: number;
  lastSeenAtEpochMs: number;
  remoteAddress?: string;
  sessionId?: string;
  app?: AndroidAppInfo;
  device?: AndroidDeviceInfo;
  protocolVersion?: number;
  tokenPresent: boolean;
}

export interface ServerState {
  port: number;
  running: boolean;
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
  error?: string;
}

export interface AdbDevice {
  serial: string;
  state: string;
  description: string;
}

export interface AdbCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  devices?: AdbDevice[];
}

