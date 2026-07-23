#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = getArgValue('--platform') ?? defaultPlatformName();
const dryRun = process.argv.includes('--dry-run');

const platformConfig = {
  'darwin-arm64': {
    archivePlatform: 'darwin',
    adbName: 'adb'
  },
  'darwin-x64': {
    archivePlatform: 'darwin',
    adbName: 'adb'
  },
  win32: {
    archivePlatform: 'windows',
    adbName: 'adb.exe'
  },
  'linux-x64': {
    archivePlatform: 'linux',
    adbName: 'adb'
  }
};

function getArgValue(name) {
  const equalPrefix = `${name}=`;
  const equalValue = process.argv.find((arg) => arg.startsWith(equalPrefix));
  if (equalValue) {
    return equalValue.slice(equalPrefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

function defaultPlatformName() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (process.platform === 'win32') {
    return 'win32';
  }
  return 'linux-x64';
}

function extractZip(zipPath, destination) {
  if (process.platform === 'win32') {
    const escapedZip = zipPath.replaceAll("'", "''");
    const escapedDestination = destination.replaceAll("'", "''");
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDestination}' -Force`
      ],
      { stdio: 'inherit' }
    );
    return;
  }

  execFileSync('unzip', ['-q', zipPath, '-d', destination], { stdio: 'inherit' });
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} ${url}`);
  }
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

const config = platformConfig[platform];
if (!config) {
  console.error(`Unsupported platform-tools target: ${platform}`);
  console.error(`Supported targets: ${Object.keys(platformConfig).join(', ')}`);
  process.exit(1);
}

const url = `https://dl.google.com/android/repository/platform-tools-latest-${config.archivePlatform}.zip`;
const targetDir = path.join(rootDir, 'resources', 'platform-tools', platform);

console.log(`Platform: ${platform}`);
console.log(`Source: ${url}`);
console.log(`Target: ${targetDir}`);

if (dryRun) {
  console.log('Dry run complete. No files were downloaded.');
  process.exit(0);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'platform-tools-'));
const zipPath = path.join(tempDir, `platform-tools-${config.archivePlatform}.zip`);
const extractDir = path.join(tempDir, 'extract');

try {
  mkdirSync(extractDir, { recursive: true });
  await downloadFile(url, zipPath);
  extractZip(zipPath, extractDir);

  const extractedPlatformToolsDir = path.join(extractDir, 'platform-tools');
  const targetAdb = path.join(targetDir, config.adbName);
  if (!existsSync(path.join(extractedPlatformToolsDir, config.adbName))) {
    throw new Error(`Downloaded archive does not contain ${config.adbName}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(extractedPlatformToolsDir, targetDir, { recursive: true });

  if (platform !== 'win32') {
    chmodSync(targetAdb, 0o755);
  }

  if (platform === defaultPlatformName()) {
    execFileSync(targetAdb, ['version'], { stdio: 'inherit' });
  }

  console.log(`Fetched Android SDK Platform-Tools for ${platform}.`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
