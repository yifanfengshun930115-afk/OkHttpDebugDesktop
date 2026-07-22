import { PROTOCOL_VERSION, type CaptureMessage, type HelloMessage } from '../shared/protocol.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHeaders(value: unknown): value is Record<string, string | string[]> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (item) =>
      typeof item === 'string' ||
      (Array.isArray(item) && item.every((entry) => typeof entry === 'string'))
  );
}

function isProtocolVersion(value: unknown): value is typeof PROTOCOL_VERSION {
  return value === PROTOCOL_VERSION;
}

export function parseClientMessage(raw: string): HelloMessage | CaptureMessage | { type: 'ping' } | { type: 'pong' } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Message is not valid JSON.');
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('Message must be an object with a type field.');
  }

  if (parsed.type === 'ping') {
    return { type: 'ping' };
  }

  if (parsed.type === 'pong') {
    return { type: 'pong' };
  }

  if (!isProtocolVersion(parsed.protocolVersion)) {
    throw new Error(`Unsupported protocolVersion: ${String(parsed.protocolVersion)}.`);
  }

  if (parsed.type === 'hello') {
    if (!isRecord(parsed.app) || !isRecord(parsed.device)) {
      throw new Error('hello requires app and device objects.');
    }

    if (
      typeof parsed.app.packageName !== 'string' ||
      typeof parsed.app.versionName !== 'string' ||
      typeof parsed.sessionId !== 'string'
    ) {
      throw new Error('hello requires app.packageName, app.versionName, and sessionId.');
    }

    return parsed as unknown as HelloMessage;
  }

  if (parsed.type === 'capture') {
    if (!isRecord(parsed.request)) {
      throw new Error('capture requires a request object.');
    }

    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.startedAtEpochMs !== 'number' ||
      typeof parsed.request.method !== 'string' ||
      typeof parsed.request.url !== 'string' ||
      !isHeaders(parsed.request.headers)
    ) {
      throw new Error('capture requires id, sessionId, startedAtEpochMs, and request fields.');
    }

    if (parsed.response !== undefined) {
      if (!isRecord(parsed.response) || typeof parsed.response.code !== 'number' || !isHeaders(parsed.response.headers)) {
        throw new Error('capture.response requires code and headers fields.');
      }
    }

    if (parsed.error !== undefined) {
      if (!isRecord(parsed.error) || typeof parsed.error.type !== 'string' || typeof parsed.error.message !== 'string') {
        throw new Error('capture.error requires type and message fields.');
      }
    }

    return parsed as unknown as CaptureMessage;
  }

  throw new Error(`Unsupported message type: ${parsed.type}.`);
}

