import { WebSocket, WebSocketServer } from 'ws';
import {
  DEFAULT_WS_PORT,
  PROTOCOL_VERSION,
  type CaptureRecord,
  type ConnectionInfo,
  type DesktopState,
  type HelloAckMessage,
  type PongMessage,
  type ServerState
} from '../shared/protocol.js';
import { parseClientMessage } from './messageValidation.js';

const MAX_CAPTURE_RECORDS = 5000;

interface InternalConnection extends ConnectionInfo {
  socket: WebSocket;
}

export class CaptureServer {
  private wss?: WebSocketServer;
  private readonly captures: CaptureRecord[] = [];
  private readonly connections = new Map<string, InternalConnection>();
  private serverError?: string;
  private connectionSeq = 0;

  constructor(
    private readonly port: number = DEFAULT_WS_PORT,
    private readonly onChange: () => void
  ) {}

  start() {
    if (this.wss) {
      return;
    }

    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });

    this.wss.on('listening', () => {
      this.serverError = undefined;
      this.onChange();
    });

    this.wss.on('error', (error) => {
      this.serverError = error.message;
      this.onChange();
    });

    this.wss.on('connection', (socket, request) => {
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
      this.onChange();

      socket.on('message', (data) => this.handleMessage(connection, data.toString('utf8')));
      socket.on('close', () => {
        this.connections.delete(id);
        this.onChange();
      });
      socket.on('error', () => {
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
      port: this.port,
      running: Boolean(this.wss),
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
        this.captures.unshift({
          ...message,
          connectionId: connection.id,
          receivedAtEpochMs: Date.now(),
          source: {
            app: connection.app,
            device: connection.device
          }
        });

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
      connection.socket.send(JSON.stringify({ type: 'error', message }));
    }
  }
}

