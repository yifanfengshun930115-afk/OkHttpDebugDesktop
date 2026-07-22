import { WebSocket, WebSocketServer } from 'ws';
import {
  DEFAULT_DEVICE_WS_PORT,
  DEFAULT_WS_PORT,
  DEFAULT_WS_PORT_RANGE_END,
  PROTOCOL_VERSION,
  type CaptureRecord,
  type ConnectionInfo,
  type DesktopState,
  type HelloAckMessage,
  type PongMessage,
  type ServerState
} from '../shared/protocol.js';
import type { CaptureLogWriter } from './captureLogWriter.js';
import { parseClientMessage } from './messageValidation.js';

const MAX_CAPTURE_RECORDS = 5000;
const LISTEN_HOST = '127.0.0.1';

interface InternalConnection extends ConnectionInfo {
  socket: WebSocket;
}

export class CaptureServer {
  private wss?: WebSocketServer;
  private readonly captures: CaptureRecord[] = [];
  private readonly connections = new Map<string, InternalConnection>();
  private serverError?: string;
  private starting = false;
  private activePort: number;
  private connectionSeq = 0;

  constructor(
    private readonly preferredPort: number = DEFAULT_WS_PORT,
    private readonly onChange: () => void,
    private readonly portRangeEnd: number = DEFAULT_WS_PORT_RANGE_END,
    private readonly devicePort: number = DEFAULT_DEVICE_WS_PORT,
    private readonly captureLogWriter?: CaptureLogWriter
  ) {
    this.activePort = preferredPort;
  }

  start() {
    if (this.wss || this.starting) {
      return;
    }

    this.starting = true;
    this.serverError = undefined;
    this.tryListen(this.preferredPort);
  }

  private tryListen(port: number) {
    const server = new WebSocketServer({ host: LISTEN_HOST, port });

    server.once('listening', () => {
      this.wss = server;
      this.activePort = port;
      this.starting = false;
      this.serverError = undefined;
      this.attachConnectionHandler(server);
      this.onChange();
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      server.close();
      if (error.code === 'EADDRINUSE' && port < this.portRangeEnd) {
        this.tryListen(port + 1);
        return;
      }
      this.starting = false;
      this.serverError =
        error.code === 'EADDRINUSE'
          ? `No free local WebSocket port in ${this.preferredPort}-${this.portRangeEnd}.`
          : error.message;
      this.onChange();
    });
  }

  private attachConnectionHandler(server: WebSocketServer) {
    server.on('connection', (socket, request) => {
      const id = `conn-${++this.connectionSeq}`;
      const now = Date.now();
      const connection: InternalConnection = {
        id,
        socket,
        connectedAtEpochMs: now,
        lastSeenAtEpochMs: now,
        remoteAddress: request.socket.remoteAddress,
        tokenPresent: false
      };

      this.connections.set(id, connection);
      this.captureLogWriter?.log({
        type: 'connection',
        connection: this.toConnectionInfo(connection),
        url: request.url
      });
      this.onChange();

      socket.on('message', (data) => this.handleMessage(connection, data.toString('utf8')));
      socket.on('close', () => {
        this.captureLogWriter?.log({ type: 'close', connection: this.toConnectionInfo(connection) });
        this.connections.delete(id);
        this.onChange();
      });
      socket.on('error', () => {
        this.captureLogWriter?.log({ type: 'socket_error', connection: this.toConnectionInfo(connection) });
        this.connections.delete(id);
        this.onChange();
      });
    });
  }

  stop() {
    for (const connection of this.connections.values()) {
      connection.socket.close();
    }
    this.connections.clear();
    this.wss?.close();
    this.wss = undefined;
    this.starting = false;
    this.onChange();
  }

  clearCaptures(): DesktopState {
    this.captures.length = 0;
    this.onChange();
    return this.getState();
  }

  getState(): DesktopState {
    return {
      server: this.getServerState(),
      captures: [...this.captures]
    };
  }

  private getServerState(): ServerState {
    const connections = [...this.connections.values()].map(({ socket: _socket, ...connection }) => connection);

    return {
      port: this.activePort,
      preferredPort: this.preferredPort,
      devicePort: this.devicePort,
      captureLogPath: this.captureLogWriter?.logPath,
      portRange: {
        start: this.preferredPort,
        end: this.portRangeEnd
      },
      running: Boolean(this.wss),
      starting: this.starting,
      error: this.serverError,
      connectionCount: connections.length,
      connections
    };
  }

  private handleMessage(connection: InternalConnection, raw: string) {
    try {
      const message = parseClientMessage(raw);
      connection.lastSeenAtEpochMs = Date.now();

      if (message.type === 'hello') {
        connection.sessionId = message.sessionId;
        connection.app = message.app;
        connection.device = message.device;
        connection.protocolVersion = message.protocolVersion;
        connection.tokenPresent = Boolean(message.token);
        this.captureLogWriter?.log({
          type: 'hello',
          connection: this.toConnectionInfo(connection),
          app: message.app,
          device: message.device,
          sessionId: message.sessionId,
          tokenPresent: connection.tokenPresent
        });

        const ack: HelloAckMessage = {
          type: 'hello_ack',
          protocolVersion: PROTOCOL_VERSION,
          server: 'OkHttp Debug Desktop',
          serverTimeEpochMs: Date.now()
        };
        connection.socket.send(JSON.stringify(ack));
        this.onChange();
        return;
      }

      if (message.type === 'capture') {
        const capture: CaptureRecord = {
          ...message,
          connectionId: connection.id,
          receivedAtEpochMs: Date.now(),
          source: {
            app: connection.app,
            device: connection.device
          }
        };

        this.captures.unshift(capture);
        this.captureLogWriter?.log({ type: 'capture', capture });

        if (this.captures.length > MAX_CAPTURE_RECORDS) {
          this.captures.length = MAX_CAPTURE_RECORDS;
        }

        this.onChange();
        return;
      }

      if (message.type === 'ping') {
        const pong: PongMessage = {
          type: 'pong',
          protocolVersion: PROTOCOL_VERSION,
          receivedAtEpochMs: Date.now()
        };
        connection.socket.send(JSON.stringify(pong));
        this.onChange();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown WebSocket message error.';
      this.captureLogWriter?.log({
        type: 'message_error',
        connection: this.toConnectionInfo(connection),
        message,
        rawLength: raw.length
      });
      connection.socket.send(JSON.stringify({ type: 'error', message }));
    }
  }

  private toConnectionInfo({ socket: _socket, ...connection }: InternalConnection): ConnectionInfo {
    return { ...connection };
  }
}
