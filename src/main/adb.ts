import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AdbCommandResult, AdbDevice } from '../shared/protocol.js';

const execFileAsync = promisify(execFile);

function resolveAdbBinary() {
  if (process.env.ADB_PATH) {
    return process.env.ADB_PATH;
  }

  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdkRoot) {
    return path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  }

  return 'adb';
}

async function runAdb(args: string[]): Promise<AdbCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(resolveAdbBinary(), args, {
      timeout: 15000,
      windowsHide: true
    });

    return {
      ok: true,
      stdout,
      stderr
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      error: err.message
    };
  }
}

function parseDevices(stdout: string): AdbDevice[] {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = '', state = '', ...descriptionParts] = line.split(/\s+/);
      return {
        serial,
        state,
        description: descriptionParts.join(' ')
      };
    });
}

export async function listAdbDevices(): Promise<AdbCommandResult> {
  const result = await runAdb(['devices', '-l']);
  return {
    ...result,
    devices: result.ok ? parseDevices(result.stdout) : []
  };
}

export async function reverseDebugPort(serial?: string): Promise<AdbCommandResult> {
  const target = 'tcp:19090';
  const args = serial ? ['-s', serial, 'reverse', target, target] : ['reverse', target, target];
  return runAdb(args);
}

