import type { AdbCommandResult, AdbDevice, UsbReverseDeviceState, UsbReverseState } from '../shared/protocol.js';
import { listAdbDevices, reverseDebugPort } from './adb.js';

const AUTO_REVERSE_INTERVAL_MS = 15000;

interface ReversePorts {
  serverRunning: boolean;
  hostPort: number;
  devicePort: number;
}

function initialState(hostPort: number, devicePort: number): UsbReverseState {
  return {
    enabled: true,
    active: false,
    hostPort,
    devicePort,
    intervalMs: AUTO_REVERSE_INTERVAL_MS,
    devices: [],
    message: 'USB 自动映射已就绪。'
  };
}

function deviceMessage(device: AdbDevice) {
  if (device.state === 'device') {
    return undefined;
  }
  if (device.state === 'unauthorized') {
    return '设备未授权。请在 Android 设备上确认 USB 调试授权。';
  }
  if (device.state === 'offline') {
    return '设备离线。请重新连接 USB 或重启 ADB。';
  }
  return `设备状态为 ${device.state}。`;
}

export class AdbReverseManager {
  private timer?: NodeJS.Timeout;
  private active = false;
  private state: UsbReverseState;

  constructor(
    private readonly getPorts: () => ReversePorts,
    private readonly onChange: () => void
  ) {
    const ports = getPorts();
    this.state = initialState(ports.hostPort, ports.devicePort);
  }

  start() {
    if (this.timer) {
      return;
    }

    this.scheduleEnsure(0);
    this.scheduleEnsure(1500);
    this.scheduleEnsure(4000);
    this.timer = setInterval(() => {
      void this.ensureNow('interval');
    }, AUTO_REVERSE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getState(): UsbReverseState {
    return {
      ...this.state,
      devices: [...this.state.devices]
    };
  }

  async ensureNow(_reason: 'startup' | 'interval' | 'manual' = 'manual'): Promise<UsbReverseState> {
    if (this.active) {
      return this.getState();
    }

    const ports = this.getPorts();
    const now = Date.now();
    this.state = {
      ...this.state,
      active: true,
      hostPort: ports.hostPort,
      devicePort: ports.devicePort,
      lastAttemptEpochMs: now,
      error: undefined,
      message: ports.serverRunning
        ? `正在检查 USB 映射 tcp:${ports.devicePort} -> tcp:${ports.hostPort}。`
        : '等待本地 WebSocket 服务启动。'
    };
    this.active = true;
    this.onChange();

    if (!ports.serverRunning) {
      this.active = false;
      this.state = {
        ...this.state,
        active: false
      };
      this.onChange();
      return this.getState();
    }

    try {
      const deviceResult = await listAdbDevices();
      if (!deviceResult.ok) {
        this.state = this.failureState(deviceResult, now, ports);
        return this.getState();
      }

      const devices = deviceResult.devices ?? [];
      const mappedDevices: UsbReverseDeviceState[] = [];
      for (const device of devices) {
        if (device.state !== 'device') {
          mappedDevices.push({
            serial: device.serial,
            state: device.state,
            description: device.description,
            mapped: false,
            lastAttemptEpochMs: now,
            error: deviceMessage(device)
          });
          continue;
        }

        const reverseResult = await reverseDebugPort(device.serial, ports.hostPort, ports.devicePort);
        mappedDevices.push({
          serial: device.serial,
          state: device.state,
          description: device.description,
          mapped: reverseResult.ok,
          lastAttemptEpochMs: now,
          error: reverseResult.ok ? undefined : reverseResult.error,
          stderr: reverseResult.stderr || undefined
        });
      }

      const successCount = mappedDevices.filter((device) => device.mapped).length;
      const eligibleCount = devices.filter((device) => device.state === 'device').length;
      this.state = {
        ...this.state,
        active: false,
        adb: deviceResult.adb,
        devices: mappedDevices,
        lastSuccessEpochMs: successCount > 0 ? now : this.state.lastSuccessEpochMs,
        error: eligibleCount > 0 && successCount === 0 ? '没有已授权 USB 设备完成映射。' : undefined,
        message:
          devices.length === 0
            ? '未检测到 USB 设备。'
            : eligibleCount === 0
              ? '检测到 USB 设备，但没有已授权设备。'
              : `USB 映射已完成：${successCount}/${eligibleCount} 台已授权设备。`
      };
      return this.getState();
    } finally {
      this.active = false;
      this.state = {
        ...this.state,
        active: false
      };
      this.onChange();
    }
  }

  private failureState(result: AdbCommandResult, now: number, ports: ReversePorts): UsbReverseState {
    return {
      ...this.state,
      active: false,
      hostPort: ports.hostPort,
      devicePort: ports.devicePort,
      adb: result.adb,
      devices: [],
      error: result.error ?? result.stderr ?? 'ADB 命令执行失败。',
      message: result.error ?? result.adb?.installHint ?? 'ADB 命令执行失败。'
    };
  }

  private scheduleEnsure(delayMs: number) {
    const timer = setTimeout(() => {
      void this.ensureNow('startup');
    }, delayMs);
    timer.unref?.();
  }
}
