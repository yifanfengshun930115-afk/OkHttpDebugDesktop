#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const platform = getArgValue('--platform') ?? currentBuildPlatform();
const target = getArgValue('--target');

function getArgValue(name) {
  const equalPrefix = `${name}=`;
  const equalValue = args.find((arg) => arg.startsWith(equalPrefix));
  if (equalValue) {
    return equalValue.slice(equalPrefix.length);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

function currentBuildPlatform() {
  if (process.platform === 'darwin') {
    return 'macos';
  }
  if (process.platform === 'win32') {
    return 'windows';
  }
  return process.platform;
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
      }
    });
  });
}

function tauriBuildArgs(bundles) {
  const buildArgs = ['tauri', 'build', '--bundles', bundles];
  if (target) {
    buildArgs.push('--target', target);
  }
  return buildArgs;
}

async function packageMacos() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS packages must be built on macOS.');
  }
  await run('npx', tauriBuildArgs('app,dmg'));
}

async function packageWindows() {
  if (process.platform !== 'win32') {
    throw new Error(
      'Windows NSIS packages must be built on Windows or a CI runner with the Windows Tauri toolchain.'
    );
  }
  await run('npx', tauriBuildArgs('nsis'));
}

async function packageLinux() {
  if (process.platform !== 'linux') {
    throw new Error('Linux packages must be built on Linux or a Linux CI runner.');
  }
  await run('npx', tauriBuildArgs('appimage,deb'));
}

try {
  if (platform === 'macos') {
    await packageMacos();
  } else if (platform === 'windows') {
    await packageWindows();
  } else if (platform === 'linux') {
    await packageLinux();
  } else {
    throw new Error(`Unsupported package platform: ${platform}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
