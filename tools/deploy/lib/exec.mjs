/**
 * child_process wrappers. Every external command is echoed (dim) before it
 * runs; in --dry-run mode the command is printed with a [dry-run] marker and
 * NOT executed. Secrets passed via `redact` are masked in the echo.
 */
import { spawnSync } from 'node:child_process';
import pc from 'picocolors';
import { isDryRun } from './ui.mjs';

function echoCmd(cmd, args, redact = []) {
  let line = [cmd, ...args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
  for (const s of redact) {
    if (s) line = line.split(s).join('***');
  }
  const prefix = isDryRun() ? pc.yellow('[dry-run] $ ') : pc.dim('$ ');
  console.log(`    ${prefix}${pc.dim(line)}`);
}

/** Run a command with inherited stdio (interactive-safe). Throws on failure. */
export function run(cmd, args = [], { redact = [], allowFail = false, env } = {}) {
  echoCmd(cmd, args, redact);
  if (isDryRun()) return { status: 0 };
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    throw new Error(`${cmd} exited with code ${res.status}`);
  }
  return res;
}

/**
 * Run a command capturing stdout. Returns the trimmed stdout, or null in
 * dry-run (callers must fall back to defaults). Throws with stderr excerpt
 * on failure.
 */
export function runCapture(cmd, args = [], { redact = [], allowFail = false } = {}) {
  echoCmd(cmd, args, redact);
  if (isDryRun()) return null;
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0) {
    if (allowFail) return null;
    const errText = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
    throw new Error(`${cmd} exited ${res.status}: ${errText}`);
  }
  return (res.stdout ?? '').trim();
}

/** Is a binary available on PATH? (never dry-run gated — read-only) */
export function which(bin) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
  });
  return res.status === 0 ? res.stdout.trim().split('\n')[0] : null;
}

const SSH_OPTS = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'];

/** Run a command on the server over ssh (interactive stdio). */
export function ssh(pemPath, host, command, opts = {}) {
  return run('ssh', ['-i', pemPath, ...SSH_OPTS, `ubuntu@${host}`, command], opts);
}

/** Copy a local file to the server. */
export function scp(pemPath, localPath, host, remotePath, opts = {}) {
  return run('scp', ['-i', pemPath, ...SSH_OPTS, localPath, `ubuntu@${host}:${remotePath}`], opts);
}
