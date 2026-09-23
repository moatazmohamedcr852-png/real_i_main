import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const baseDir = 'C:\\Users\\Public\\pgsql16';
const zipPath = 'C:\\Users\\Public\\pgsql16.zip';
const binDir = path.join(baseDir, 'pgsql', 'bin');
const dataDir = path.join(baseDir, 'data');
const logFile = path.join(baseDir, 'pg.log');

function findExistingPgBin() {
  const candidates = [
    'C:\\Users\\Public\\pgsql\\bin',
    'C:\\Users\\Public\\pgsql16\\pgsql\\bin',
    'C:\\Program Files\\PostgreSQL\\18\\bin',
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\16\\bin'
  ];
  for (const bin of candidates) {
    if (fs.existsSync(path.join(bin, 'initdb.exe'))) return bin;
  }
  return null;
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

export async function setupAndStartPg() {
  console.log('=== Checking Local PostgreSQL Instance ===');

  let resolvedBinDir = findExistingPgBin();

  if (!resolvedBinDir) {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`PostgreSQL portable zip archive not found at ${zipPath}`);
    }
    console.log(`Extracting ${zipPath} to ${baseDir}...`);
    execSync(`tar -xf "${zipPath}" -C "C:\\Users\\Public"`, { stdio: 'inherit' });
    resolvedBinDir = findExistingPgBin();
  }

  if (!resolvedBinDir) {
    throw new Error('Could not find a PostgreSQL bin directory.');
  }

  const resolvedDataDir = resolvedBinDir.includes('pgsql')
    ? path.join(path.dirname(resolvedBinDir), 'data')
    : path.join(path.resolve(resolvedBinDir, '..', '..'), 'data');
  const resolvedLogFile = path.join(path.dirname(resolvedBinDir), 'pg.log');

  console.log(`PostgreSQL binaries located at: ${resolvedBinDir}`);
  process.env.PATH = `${resolvedBinDir};${process.env.PATH}`;

  // 1. Initialize DB cluster if not already initialized
  if (!fs.existsSync(path.join(resolvedDataDir, 'PG_VERSION'))) {
    console.log(`Initializing database cluster at ${resolvedDataDir}...`);
    const initRes = spawnSync(
      path.join(resolvedBinDir, 'initdb.exe'),
      ['-D', resolvedDataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'],
      { stdio: 'inherit' }
    );
    if (initRes.status !== 0) {
      throw new Error('initdb failed');
    }
  }

  // 2. Start PostgreSQL server (idempotent: safe if already running)
  console.log('Starting PostgreSQL server daemon...');
  const startRes = spawnSync(
    path.join(resolvedBinDir, 'pg_ctl.exe'),
    ['-D', resolvedDataDir, '-l', resolvedLogFile, 'start'],
    { stdio: 'inherit' }
  );
  if (startRes.status !== 0) {
    console.log('pg_ctl reported non-zero; checking if server is already accepting connections...');
  }

  const ready = await waitForPort('127.0.0.1', 5432, Number(process.env.PG_START_TIMEOUT_MS) || 20000);
  if (!ready) {
    throw new Error('PostgreSQL did not become ready on port 5432. Check the log at ' + resolvedLogFile);
  }

  // 3. Create 'real_i' database if not exists
  console.log('Ensuring database "real_i" exists...');
  try {
    spawnSync(path.join(resolvedBinDir, 'createdb.exe'), ['-U', 'postgres', '-h', 'localhost', '-p', '5432', 'real_i'], {
      stdio: 'ignore'
    });
    console.log('Database "real_i" ready.');
  } catch (_) {}

  console.log('PostgreSQL is up and running on localhost:5432!');
}

if (process.argv[1].endsWith('setup-local-pg.js')) {
  setupAndStartPg();
}
