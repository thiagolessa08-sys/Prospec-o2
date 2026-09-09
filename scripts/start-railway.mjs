import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const port = process.env.PORT || '3000';
const persistenceDirectory =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || '.wrangler/state';
const wrangler = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);

mkdirSync(persistenceDirectory, { recursive: true });

const encryptionKeyFile = join(persistenceDirectory, 'app-encryption-key');
let encryptionKey = process.env.APP_ENCRYPTION_KEY;

if (!encryptionKey && existsSync(encryptionKeyFile)) {
  encryptionKey = readFileSync(encryptionKeyFile, 'utf8').trim();
}

if (!encryptionKey) {
  encryptionKey = randomBytes(32).toString('hex');
  writeFileSync(encryptionKeyFile, encryptionKey, { mode: 0o600 });
}

if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
  console.error('APP_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.');
  process.exit(1);
}

const commonArguments = [
  '--config',
  'dist/server/wrangler.json',
  '--persist-to',
  persistenceDirectory,
];

const initialize = spawnSync(
  process.execPath,
  [
    wrangler,
    'd1',
    'execute',
    'site-creator-d1',
    '--local',
    ...commonArguments,
    '--file',
    'scripts/railway-init.sql',
  ],
  { stdio: 'inherit', env: process.env },
);

if (initialize.status !== 0) {
  process.exit(initialize.status || 1);
}

const argumentsForServer = [
  wrangler,
  'dev',
  '--ip',
  '0.0.0.0',
  '--port',
  port,
  ...commonArguments,
  '--show-interactive-dev-session=false',
];

argumentsForServer.push('--var', `APP_ENCRYPTION_KEY:${encryptionKey}`);

const server = spawn(process.execPath, argumentsForServer, {
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code || 0);
});
