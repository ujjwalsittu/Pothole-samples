#!/usr/bin/env node
/**
 * Fast server updater — pushes the latest committed code to a Lightsail
 * server WITHOUT re-running the full deployer:
 *   git pull → npm install → migrate → rebuild admin → restart API → health.
 *
 *   npm run update-server -- --host 52.66.126.205 --pem ~/Downloads/key.pem
 *
 * Host/pem default from .deploy-state.json (if kept) and common key paths.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

// Pull defaults from deploy state when available.
let state = {};
try {
  state = JSON.parse(fs.readFileSync(path.resolve('.deploy-state.json'), 'utf8'));
} catch {
  /* no state — flags required */
}

const host = flag('--host') ?? state.artifacts?.staticIp;
if (!host) {
  console.error('Usage: npm run update-server -- --host <server-ip> [--pem <key.pem>]');
  process.exit(1);
}

const expand = (p) => p.replace(/^~(?=$|\/)/, os.homedir());
const candidates = [
  flag('--pem') && expand(flag('--pem')),
  process.env.PEM_PATH && expand(process.env.PEM_PATH),
  state.artifacts?.pemPath,
  ...fs
    .readdirSync(path.join(os.homedir(), '.ssh'))
    .filter((f) => /^lightsail-default-.*\.pem$/.test(f))
    .map((f) => path.join(os.homedir(), '.ssh', f)),
  path.join(os.homedir(), '.ssh', 'pothole-deploy-key.pem'),
].filter(Boolean);

const pem = candidates.find((p) => fs.existsSync(p));
if (!pem) {
  console.error('No SSH key found — pass one with --pem /path/to/key.pem');
  process.exit(1);
}
try {
  if ((fs.statSync(pem).mode & 0o077) !== 0) fs.chmodSync(pem, 0o600);
} catch {
  /* best effort */
}

const REMOTE = [
  'set -e',
  'cd /opt/pothole',
  'echo "== was: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"',
  'git pull --ff-only',
  'echo "== now: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"',
  'npm install',
  'npm run migrate --workspace apps/api',
  'npm run build --workspace apps/admin',
  'sudo systemctl restart pothole-api',
  'sleep 3',
  'curl -fsS http://localhost:4000/api/v1/health && echo',
  'echo "== update complete"',
].join(' && ');

console.log(`Updating ubuntu@${host} using ${pem}\n`);
try {
  execFileSync(
    'ssh',
    ['-i', pem, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', `ubuntu@${host}`, REMOTE],
    { stdio: 'inherit' },
  );
} catch {
  console.error('\nUpdate failed — see output above. The API keeps running the previous');
  console.error('version unless the restart step was reached. Re-run after fixing.');
  process.exit(1);
}
console.log('\n✔ Server updated. Admin dashboard changes are live immediately;');
console.log('  hard-refresh the browser (Cmd+Shift+R) to bypass cached assets.');
