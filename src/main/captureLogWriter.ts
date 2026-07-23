import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AndroidAppInfo, AndroidDeviceInfo, CaptureRecord, ConnectionInfo } from '../shared/protocol.js';

export type CaptureLogEntry =
  | {
      type: 'connection';
      connection: ConnectionInfo;
      url?: string;
    }
  | {
      type: 'hello';
      connection: ConnectionInfo;
      app: AndroidAppInfo;
      device: AndroidDeviceInfo;
      clientTag?: string;
    }
  | {
      type: 'capture';
      capture: CaptureRecord;
    }
  | {
      type: 'close' | 'socket_error';
      connection: ConnectionInfo;
    }
  | {
      type: 'message_error';
      connection: ConnectionInfo;
      message: string;
      rawLength: number;
    };

function logDateStamp(date: Date) {
  return date.toISOString().slice(0, 10);
}

export class CaptureLogWriter {
  private writeQueue = Promise.resolve();

  constructor(
    private readonly logDir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  get logPath() {
    return path.join(this.logDir, `captures-${logDateStamp(this.now())}.jsonl`);
  }

  log(entry: CaptureLogEntry) {
    const ts = this.now().toISOString();
    const filePath = this.logPath;
    const line = JSON.stringify({ ts, ...entry }) + '\n';

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.logDir, { recursive: true });
        await appendFile(filePath, line, 'utf8');
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to write capture log: ${message}`);
      });
  }
}
