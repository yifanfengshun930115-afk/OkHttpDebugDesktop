#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

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

function sdkPlatformToolsDir(sdkRoot) {
  return sdkRoot ? path.join(sdkRoot, 'platform-tools') : undefined;
}

function whichAdb() {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(command, [adbFileName()], { encoding: 'utf8' });
    return output.split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

function candidateDirs() {
  const home = os.homedir();
  const adbPath = process.env.ADB_PATH;
  const adbDir = adbPath ? path.dirname(adbPath) : undefined;
  const candidates = [
    adbDir,
    sdkPlatformToolsDir(process.env.ANDROID_HOME),
    sdkPlatformToolsDir(process.env.ANDROID_SDK_ROOT)
  ];

  if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Android', 'sdk', 'platform-tools'),
      '/opt/homebrew/share/android-commandlinetools/platform-tools',
      '/usr/local/share/android-commandlinetools/platform-tools'
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools'),
      path.join(process.env.PROGRAMFILES ?? '', 'Android', 'platform-tools')
    );
  } else {
    candidates.push(
      path.join(home, 'Android', 'Sdk', 'platform-tools'),
      '/opt/android-sdk/platform-tools',
      '/usr/lib/android-sdk/platform-tools'
    );
  }

  const adbFromPath = whichAdb();
  if (adbFromPath) {
    candidates.push(path.dirname(adbFromPath));
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate || seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
}

function findPlatformToolsDir() {
  return candidateDirs().find((dir) => existsSync(path.join(dir, adbFileName())));
}

const sourceDir = findPlatformToolsDir();
if (!sourceDir) {
  console.error('No Android SDK platform-tools directory containing adb was found.');
  console.error('Install Android SDK Platform-Tools or set ADB_PATH/ANDROID_HOME, then rerun this script.');
  process.exit(1);
}

const targetDir = path.join(rootDir, 'resources', 'platform-tools', bundledPlatformName());
const sourceAdb = path.join(sourceDir, adbFileName());
const targetAdb = path.join(targetDir, adbFileName());

console.log(`Source: ${sourceDir}`);
console.log(`Target: ${targetDir}`);

if (dryRun) {
  console.log('Dry run complete. No files were copied.');
  process.exit(0);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(path.dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

if (process.platform !== 'win32') {
  chmodSync(targetAdb, 0o755);
}

execFileSync(targetAdb, ['version'], { stdio: 'inherit' });
console.log(`Bundled platform-tools for ${bundledPlatformName()}.`);
