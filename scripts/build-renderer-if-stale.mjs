#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(projectRoot, 'dist', 'index.html');
const inputs = [
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'src/renderer',
  'src/shared'
];

async function getLatestInputMtimeMs() {
  let latest = 0;
  for (const input of inputs) {
    latest = Math.max(latest, await getLatestMtimeMs(path.join(projectRoot, input)));
  }
  return latest;
}

async function getLatestMtimeMs(filePath) {
  let currentStat;
  try {
    currentStat = await stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  if (!currentStat.isDirectory()) {
    return currentStat.mtimeMs;
  }

  let latest = currentStat.mtimeMs;
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(filePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') {
      continue;
    }
    latest = Math.max(latest, await getLatestMtimeMs(path.join(filePath, entry.name)));
  }
  return latest;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function needsBuild() {
  let outputStat;
  try {
    outputStat = await stat(outputFile);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return true;
    }
    throw error;
  }

  return (await getLatestInputMtimeMs()) > outputStat.mtimeMs;
}

if (await needsBuild()) {
  console.log('[tauri] Renderer output is stale. Building Vite assets...');
  await run('npm', ['run', 'build:renderer']);
} else {
  console.log('[tauri] Renderer output is current. Skipping Vite build.');
}
