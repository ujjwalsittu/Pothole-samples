/** Prompt helpers, step runner and banners for the PotholeCollect deployer. */
import prompts from 'prompts';
import pc from 'picocolors';
import { isStepDone, markStepDone } from './state.mjs';

let DRY = false;
export const setDryRun = (v) => {
  DRY = Boolean(v);
};
export const isDryRun = () => DRY;

const onCancel = () => {
  console.log(pc.red('\nAborted by user.'));
  process.exit(1);
};

/* ------------------------------- prompts -------------------------------- */

const cancelledIf = (cond) => {
  if (cond) onCancel();
};

export async function text(message, { initial, validate } = {}) {
  const { v } = await prompts(
    { type: 'text', name: 'v', message, initial, validate },
    { onCancel },
  );
  cancelledIf(v === undefined);
  return typeof v === 'string' ? v.trim() : v;
}

export async function secret(message, { validate, optional = false } = {}) {
  const { v } = await prompts(
    {
      type: 'password',
      name: 'v',
      message: optional ? `${message} ${pc.dim('(empty to skip)')}` : message,
      validate,
    },
    { onCancel },
  );
  return typeof v === 'string' ? v.trim() : v;
}

export async function confirm(message, initial = false) {
  const { v } = await prompts({ type: 'confirm', name: 'v', message, initial }, { onCancel });
  return Boolean(v);
}

export async function select(message, choices, initialIndex = 0) {
  const { v } = await prompts(
    { type: 'select', name: 'v', message, choices, initial: initialIndex },
    { onCancel },
  );
  // Non-TTY stdin can auto-submit the raw initial index instead of a choice
  // value — treat anything that is not a real choice value as a cancel, so
  // EOF never silently picks a target or writes bogus state.
  cancelledIf(!choices.some((c) => c.value === v));
  return v;
}

/** "Press Enter to continue" gate. */
export async function pressEnter(message) {
  await prompts(
    { type: 'invisible', name: 'v', message: `${message} ${pc.dim('(press Enter)')}` },
    { onCancel },
  );
}

/* ------------------------------ validators ------------------------------ */

export const validators = {
  domain: (v) =>
    /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(v).trim()) ||
    'Enter a bare domain like potholes.example.com (no scheme, no slash)',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) || 'Enter a valid email',
  nonEmpty: (v) => String(v).trim().length > 0 || 'Required',
  url: (v) => /^https?:\/\/.+/.test(String(v).trim()) || 'Enter a URL (https://…)',
};

/* -------------------------------- output -------------------------------- */

export function banner() {
  const line = '─'.repeat(58);
  const row = (txt, paint) => pc.cyan('│') + paint(txt.padEnd(58)) + pc.cyan('│');
  console.log(pc.cyan(`\n┌${line}┐`));
  console.log(row('   PotholeCollect deployer', pc.bold));
  console.log(row('   Powered by Threemates Tech Ventures', pc.dim));
  console.log(pc.cyan(`└${line}┘`));
  if (DRY) console.log(pc.yellow('  ⚠ DRY-RUN: no external command will actually run.\n'));
}

export function section(title) {
  console.log(`\n${pc.bold(pc.cyan(`── ${title} `))}${pc.cyan('─'.repeat(Math.max(2, 54 - title.length)))}`);
}

export function note(msg) {
  console.log(pc.dim(`  ${msg}`));
}

export function warn(msg) {
  console.log(pc.yellow(`  ⚠ ${msg}`));
}

export function highlightBlock(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(pc.bgCyan(pc.black(' '.repeat(width))));
  for (const l of lines) {
    console.log(pc.bgCyan(pc.black(`  ${l}`.padEnd(width))));
  }
  console.log(pc.bgCyan(pc.black(' '.repeat(width))));
}

/* ------------------------------ step runner ----------------------------- */

/**
 * Run one deployment step. Prints ✔ on success, ✖ on failure — and on
 * failure shows the exact manual command + doc pointer, then asks
 * continue/abort (dry-run always continues). Never crashes the flow.
 *
 * RESUME: step labels are a stable contract. A label already recorded in the
 * state file is skipped (↷) and treated as done — unless `alwaysRun` is set
 * (auth refreshes, DNS waits, health checks). Successful steps are persisted
 * immediately, so an abort/crash resumes from the first incomplete step.
 */
export async function runStep(label, fn, { manual, docs, optional = false, alwaysRun = false } = {}) {
  if (!alwaysRun && isStepDone(label)) {
    console.log(`  ${pc.yellow('↷')} ${label} ${pc.dim('(done in previous run)')}`);
    return { ok: true, cached: true };
  }
  process.stdout.write(pc.dim(`  … ${label}\n`));
  try {
    const value = await fn();
    console.log(`  ${pc.green('✔')} ${label}`);
    if (!alwaysRun) markStepDone(label);
    return { ok: true, value };
  } catch (err) {
    console.log(`  ${pc.red('✖')} ${label}`);
    console.log(pc.red(`    ${String(err?.message ?? err).split('\n')[0]}`));
    if (manual) {
      console.log(pc.yellow('    Run manually and re-run the deployer, or continue:'));
      console.log(pc.bold(`      ${manual}`));
    }
    if (docs) console.log(pc.dim(`    See: ${docs}`));
    if (DRY || optional) return { ok: false, error: err };
    const cont = await confirm('Continue with the remaining steps anyway?', false);
    if (!cont) {
      console.log(pc.red('Aborting. Nothing else will be changed.'));
      process.exit(1);
    }
    return { ok: false, error: err };
  }
}

/** Mark a step as intentionally skipped. */
export function skipStep(label, reason) {
  console.log(`  ${pc.yellow('↷')} ${label}${reason ? pc.dim(` — ${reason}`) : ''}`);
}
