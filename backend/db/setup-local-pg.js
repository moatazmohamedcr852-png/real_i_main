import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const baseDir = 'C:\\Users\\Public\\pgsql16';
const zipPath = 'C:\\Users\\Public\\pgsql16.zip';
const binDir = path.join(baseDir, 'pgsql', 'bin');
const dataDir = path.join(baseDir, 'data');
const logFile = path.join(baseDir, 'pg.log');

export function setupAndStartPg() {
  console.log('=== Checking Local PostgreSQL Portable Instance ===');

  if (!fs.existsSync(binDir)) {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`PostgreSQL portable zip archive not found at ${zipPath}`);
    }
    console.log(`Extracting ${zipPath} to ${baseDir}...`);
    execSync(`tar -xf "${zipPath}" -C "C:\\Users\\Public"`, { stdio: 'inherit' });
    if (!fs.existsSync(binDir) && fs.existsSync('C:\\Users\\Public\\pgsql\\bin')) {
      // Renamed or extracted directly to C:\Users\Public\pgsql
    }
  }

  const resolvedBinDir = fs.existsSync(binDir)
    ? binDir
    : fs.existsSync('C:\\Users\\Public\\pgsql\\bin')
    ? 'C:\\Users\\Public\\pgsql\\bin'
    : null;

  if (!resolvedBinDir) {
    throw new Error('Could not find pgsql/bin after extraction.');
  }

  const resolvedDataDir = path.join(path.dirname(resolvedBinDir), 'data');
  const resolvedLogFile = path.join(path.dirname(resolvedBinDir), 'pg.log');

  console.log(`PostgreSQL binaries located at: ${resolvedBinDir}`);
  process.env.PATH = `${resolvedBinDir};${process.env.PATH}`;

  // 1. Initialize DB cluster if not already initialized
  if (!fs.existsSync(resolvedDataDir)) {
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

  // 2. Start PostgreSQL server
  console.log('Starting PostgreSQL server daemon...');
  const startRes = spawnSync(
    path.join(resolvedBinDir, 'pg_ctl.exe'),
    ['-D', resolvedDataDir, '-l', resolvedLogFile, 'start'],
    { stdio: 'inherit' }
  );

  // Wait for server socket to open
  execSync('powershell -Command "Start-Sleep -Seconds 2"', { stdio: 'ignore' });

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
