import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_DEVICE_WS_PORT,
  DEFAULT_WS_PORT,
  type AdbCommandResult,
  type AdbDevice,
  type AdbInfo
} from '../shared/protocol.js';

const execFileAsync = promisify(execFile);
const ADB_INSTALL_HINT =
  '未找到 ADB。请通过 Android Studio SDK Manager 或 Google Platform-Tools 安装 Android SDK Platform-Tools，并设置 ADB_PATH 或 ANDROID_HOME；也可以把内置 ADB 放到 resources/platform-tools/<platform>/adb。';

interface AdbCandidate {
  path: string;
  source: string;
}

function adbFileName() {
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

function bundledPlatformName() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (process.platform === 'win32') {
    return 'win32';
  }
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function candidate(pathValue: string | undefined, source: string): AdbCandidate[] {
  return pathValue ? [{ path: pathValue, source }] : [];
}

function candidateFromSdkRoot(sdkRoot: string | undefined, source: string): AdbCandidate[] {
  return sdkRoot ? candidate(path.join(sdkRoot, 'platform-tools', adbFileName()), source) : [];
}

function getResourcesPath() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resourcesPath ?? path.resolve(process.cwd(), 'resources');
}

function getPathCandidates(): AdbCandidate[] {
  const home = os.homedir();
  const resourcesPath = getResourcesPath();
  const bundledRoot = path.join(resourcesPath, 'platform-tools', bundledPlatformName());
  const candidates: AdbCandidate[] = [
    ...candidate(process.env.ADB_PATH, 'ADB_PATH'),
    ...candidate(path.join(bundledRoot, adbFileName()), 'bundled platform-tools'),
    ...candidateFromSdkRoot(process.env.ANDROID_HOME, 'ANDROID_HOME'),
    ...candidateFromSdkRoot(process.env.ANDROID_SDK_ROOT, 'ANDROID_SDK_ROOT')
  ];

  if (process.platform === 'darwin') {
    candidates.push(
      { path: path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'), source: 'Android Studio default SDK' },
      { path: '/opt/homebrew/bin/adb', source: 'Homebrew' },
      { path: '/usr/local/bin/adb', source: 'Homebrew' }
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      {
        path: path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
        source: 'Android Studio default SDK'
      },
      {
        path: path.join(process.env.PROGRAMFILES ?? '', 'Android', 'platform-tools', 'adb.exe'),
        source: 'Program Files'
      }
    );
  } else {
    candidates.push(
      { path: path.join(home, 'Android', 'Sdk', 'platform-tools', 'adb'), source: 'Android Studio default SDK' },
      { path: '/usr/bin/adb', source: 'system PATH' },
      { path: '/usr/local/bin/adb', source: 'system PATH' }
    );
  }

  candidates.push({ path: 'adb', source: 'PATH' });

  const seen = new Set<string>();
  return candidates.filter((item) => {
    if (!item.path || seen.has(item.path)) {
      return false;
    }
    seen.add(item.path);
    return true;
  });
}

async function runBinary(binary: string, args: string[]) {
  return execFileAsync(binary, args, {
    timeout: 15000,
    windowsHide: true
  });
}

function parseVersion(stdout: string) {
  return stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

export async function detectAdb(): Promise<AdbInfo> {
  const candidates = getPathCandidates();
  const checkedPaths: string[] = [];

  for (const item of candidates) {
    checkedPaths.push(item.path);
    if (item.path !== 'adb' && !existsSync(item.path)) {
      continue;
    }
    try {
      const { stdout } = await runBinary(item.path, ['version']);
      return {
        available: true,
        path: item.path,
        source: item.source,
        version: parseVersion(stdout),
        checkedPaths,
        installHint: ADB_INSTALL_HINT
      };
    } catch {
      continue;
    }
  }

  return {
    available: false,
    checkedPaths,
    installHint: ADB_INSTALL_HINT
  };
}

async function runAdb(args: string[]): Promise<AdbCommandResult> {
  const adb = await detectAdb();
  if (!adb.available || !adb.path) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: ADB_INSTALL_HINT,
      adb
    };
  }

  try {
    const { stdout, stderr } = await runBinary(adb.path, args);
    return {
      ok: true,
      stdout,
      stderr,
      adb
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      error: err.message,
      adb
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

export async function reverseDebugPort(
  serial?: string,
  hostPort: number = DEFAULT_WS_PORT,
  devicePort: number = DEFAULT_DEVICE_WS_PORT
): Promise<AdbCommandResult> {
  const deviceTarget = `tcp:${devicePort}`;
  const hostTarget = `tcp:${hostPort}`;
  const args = serial
    ? ['-s', serial, 'reverse', deviceTarget, hostTarget]
    : ['reverse', deviceTarget, hostTarget];
  return runAdb(args);
}
