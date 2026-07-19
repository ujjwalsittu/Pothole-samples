/**
 * Persistent deploy state — makes every run resumable. Stored at
 * <repo-root>/.deploy-state.json (mode 0600 — it CONTAINS SECRETS).
 * Dry-run rehearsals use .deploy-state.dryrun.json so they never pollute
 * real state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDryRun } from './ui.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function stateFilePath() {
  return path.join(REPO_ROOT, isDryRun() ? '.deploy-state.dryrun.json' : '.deploy-state.json');
}

let warned = false;

function emptyState() {
  return {
    version: 1,
    target: null,
    answers: {},
    artifacts: {},
    completedSteps: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function loadState() {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

function write(state) {
  const file = stateFilePath();
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600); // ensure mode even if the file pre-existed
  } catch {
    /* best effort */
  }
  if (!warned) {
    warned = true;
    console.log(
      `  [2mState (incl. secrets) saved to ${file} — mode 600, git-ignored. Delete it after a successful deploy.[0m`,
    );
  }
  return state;
}

/** Merge a patch into the state (creating it if absent) and persist. */
export function saveState(patch) {
  const state = { ...(loadState() ?? emptyState()), ...patch };
  return write(state);
}

export function markStepDone(label) {
  const state = loadState() ?? emptyState();
  if (!state.completedSteps.includes(label)) {
    state.completedSteps.push(label);
    write(state);
  }
}

export function isStepDone(label) {
  const state = loadState();
  return Boolean(state?.completedSteps?.includes(label));
}

export function setArtifact(key, value) {
  const state = loadState() ?? emptyState();
  state.artifacts = { ...state.artifacts, [key]: value };
  write(state);
}

export function getArtifact(key) {
  return loadState()?.artifacts?.[key];
}

export function clearState() {
  try {
    fs.unlinkSync(stateFilePath());
  } catch {
    /* already gone */
  }
}

/** Deep-copy with secret-looking values masked (for --state display). */
export function maskedState(state) {
  const SECRET_KEY = /secret|password|apikey|api_key|token|resend|accesskey|access_key/i;
  const mask = (obj) => {
    if (Array.isArray(obj)) return obj.map(mask);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = SECRET_KEY.test(k) && typeof v === 'string' && v ? '***' : mask(v);
      }
      return out;
    }
    return obj;
  };
  return mask(state);
}
