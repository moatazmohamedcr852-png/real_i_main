import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, 'services', 'core-api', '.env') });
dotenv.config({ path: path.join(root, 'services', 'ai-service', '.env') });
const children = [];
let replset;

async function resolvePython() {
  for (const command of process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']]) {
    const found = await new Promise((resolve) => {
      const result = spawn(command[0], [...command.slice(1), '--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      result.stdout.on('data', (chunk) => { output += chunk; });
      result.stderr.on('data', (chunk) => { output += chunk; });
      result.on('error', () => resolve(null));
      result.on('close', (code) => resolve(code === 0 && /Python 3\./.test(output) && !/Microsoft Store/i.test(output) ? command : null));
    });
    if (found) return found;
  }
  return null;
}

function run(command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal || code) console.error(`${command} exited (${signal || code})`);
  });
  return child;
}

async function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  if (replset) await replset.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Starting in-memory MongoDB replica set (transactions enabled)...');
replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const mongodbUri = replset.getUri('real_i');
console.log(`MongoDB ready at ${mongodbUri}`);

const sharedEnv = {
  ...process.env,
  MONGODB_URI: mongodbUri,
  NODE_ENV: 'development',
  PORT: process.env.PORT || '3001',
  CORS_ORIGINS: 'http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://localhost:3000',
  SERVE_WEB: 'true',
  LOCAL_SEED_USERS: 'true',
  LOCAL_EMBEDDINGS: 'true',
  LOCAL_VECTOR_SEARCH: 'true',
  AI_SERVICE_BASE_URL: 'http://127.0.0.1:8001',
  AI_CHAT_TIMEOUT_MS: process.env.AI_CHAT_TIMEOUT_MS || '25000',
  AI_INTERNAL_JWT_KEYS_JSON: process.env.AI_INTERNAL_JWT_KEYS_JSON || JSON.stringify({ [process.env.AI_INTERNAL_JWT_KID || '2026-01']: process.env.AI_INTERNAL_JWT_SECRET || 'super-secret-internal-jwt-key-minimum-32-chars-long' })
};

run(process.execPath, ['src/server.js'], { cwd: path.join(root, 'services', 'core-api'), env: sharedEnv });

const python = await resolvePython();
if (!python) {
  console.warn('Python 3 was not found. Core API + UI will run; AI chat/ingest will stay unavailable until Python is installed.');
} else {
  const aiDir = path.join(root, 'services', 'ai-service');
  const marker = path.join(aiDir, '.local-deps-installed');
  if (!fs.existsSync(marker)) {
    console.log('Installing AI service Python dependencies...');
    await new Promise((resolve, reject) => {
      const pip = spawn(python[0], [...python.slice(1), '-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: aiDir, stdio: 'inherit', windowsHide: true, env: sharedEnv });
      pip.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pip install failed (${code})`)));
      pip.on('error', reject);
    });
    fs.writeFileSync(marker, new Date().toISOString());
  }
  console.log('Starting AI service on http://127.0.0.1:8001 ...');
  run(python[0], [...python.slice(1), '-m', 'app'], { cwd: aiDir, env: sharedEnv });
}

console.log('Open http://localhost:3001/login');
console.log('Accounts: admin@local.test / LocalAdmin1234 | instructor@local.test / LocalInstructor1234 | student@local.test / LocalStudent1234');
