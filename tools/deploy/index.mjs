#!/usr/bin/env node
/**
 * PotholeCollect one-command deployer.
 *
 *   npm run deploy            # interactive
 *   npm run deploy -- --dry-run   # full flow, prints every command instead of running it
 *
 * Automates docs/DEPLOYMENT.md — Railway (§1–2) or AWS Lightsail (§2b).
 * Scripted answers (for testing): DEPLOY_ANSWERS='[…json array…]' injects
 * them into the prompts in order.
 */
import pc from 'picocolors';
import prompts from 'prompts';
import { deployAws } from './lib/aws.mjs';
import { collectAwsBasics, collectCommon, collectRailwayStorage } from './lib/collect.mjs';
import { deployRailway } from './lib/railway.mjs';
import { which } from './lib/exec.mjs';
import {
  clearState,
  loadState,
  maskedState,
  saveState,
  stateFilePath,
} from './lib/state.mjs';
import { banner, confirm, isDryRun, note, section, select, setDryRun, warn } from './lib/ui.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: pothole-deploy [--dry-run] [--fresh] [--state]

  --dry-run   Walk the entire flow (all prompts) but print every external
              command instead of executing it. Nothing is created. Uses a
              separate state file (.deploy-state.dryrun.json).
  --fresh     Discard any saved deployment state and start over (no prompt).
  --state     Print the saved deployment state (secrets masked) and exit.
  --pem <path>  Use this SSH private key for Lightsail provisioning
              (skips automatic key detection; PEM_PATH env also works).
`);
  process.exit(0);
}
setDryRun(args.includes('--dry-run'));

if (args.includes('--state')) {
  const s = loadState();
  if (!s) {
    console.log(`No saved state at ${stateFilePath()}`);
  } else {
    console.log(pc.dim(`# ${stateFilePath()} (secrets masked)`));
    console.log(JSON.stringify(maskedState(s), null, 2));
  }
  process.exit(0);
}
if (args.includes('--fresh')) {
  clearState();
  console.log(pc.yellow(`Saved state discarded (${stateFilePath()}).`));
}

if (process.env.DEPLOY_ANSWERS) {
  try {
    prompts.inject(JSON.parse(process.env.DEPLOY_ANSWERS));
  } catch (err) {
    console.error(pc.red(`DEPLOY_ANSWERS is not valid JSON: ${err.message}`));
    process.exit(1);
  }
}

banner();

/* ------------------------------ preflight ------------------------------- */
section('Preflight');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error(pc.red(`Node ${process.versions.node} found — Node 18+ required.`));
  process.exit(1);
}
const BINARIES = [
  ['git', 'xcode-select --install (macOS ships git)', true],
  ['ssh', 'preinstalled on macOS/Linux', true],
  ['aws', 'brew install awscli', false],
  ['railway', 'brew install railway', false],
];
const available = {};
for (const [bin, hint] of BINARIES) {
  available[bin] = Boolean(which(bin));
  if (available[bin]) {
    console.log(`  ${pc.green('✔')} ${bin}`);
  } else {
    console.log(`  ${pc.yellow('•')} ${bin} ${pc.dim('missing')} — ${pc.bold(hint)}`);
  }
}
note('aws is needed for the Lightsail path, railway for the Railway path only.');

/* --------------------------- resume / fresh ------------------------------ */
let target;
let cfg;
let resumed = false;
const existing = loadState();
if (existing?.target) {
  section('Previous deployment found');
  console.log(`    Target:     ${pc.bold(existing.target)}
    Domains:    ${existing.answers?.apiDomain ?? '?'} / ${existing.answers?.adminDomain ?? '?'}
    Progress:   ${existing.completedSteps?.length ?? 0} step(s) completed
    Last touch: ${existing.updatedAt}`);
  const action = await select('What do you want to do?', [
    { title: 'Resume — skip answered questions and completed steps', value: 'resume' },
    { title: 'Start fresh — delete the saved state and begin again', value: 'fresh' },
    { title: 'Quit', value: 'quit' },
  ]);
  if (action === 'quit') process.exit(0);
  if (action === 'fresh') {
    const sure = await confirm('Delete the saved state (incl. stored secrets)?', false);
    if (!sure) process.exit(0);
    clearState();
    note('State deleted — starting over.');
  } else {
    target = existing.target;
    cfg = { ...existing.answers };
    resumed = true;
    console.log(pc.dim(`    Reusing answers: base=${cfg.baseDomain}, api=${cfg.apiDomain}, admin=${cfg.adminDomain},`));
    console.log(pc.dim(`      auth0=${cfg.auth0Domain}, audience=${cfg.auth0Audience}, admin-email=${cfg.adminEmail}`));
  }
}

/* -------------------------------- target -------------------------------- */
if (!resumed) {
  target = await select('Where do you want to deploy?', [
    { title: 'Railway — managed, minutes to set up, S3 storage required', value: 'railway' },
    { title: 'AWS Lightsail — one Ubuntu VM, persistent disk, in-panel OSRM', value: 'lightsail' },
  ]);
}

const missingTargetBin =
  (target === 'railway' && !available.railway && 'railway CLI missing — install it first: brew install railway  (or npm i -g @railway/cli)') ||
  (target === 'lightsail' && !available.aws && 'aws CLI missing — install it first: brew install awscli');
if (missingTargetBin) {
  warn(missingTargetBin);
  if (!args.includes('--dry-run')) process.exit(1);
  note('dry-run: continuing without the binary (commands are printed, not executed).');
}

/* -------------------------------- collect ------------------------------- */
if (!resumed) {
  cfg = await collectCommon();
  if (target === 'railway') Object.assign(cfg, await collectRailwayStorage());
  else Object.assign(cfg, await collectAwsBasics());
  // Persist immediately: a crash right after the questionnaire is resumable.
  saveState({ target, answers: cfg });
}

// --pem <path>: explicit SSH key override for the Lightsail provisioning
// steps (not persisted — read fresh on every launch).
const pemIdx = args.indexOf('--pem');
if (pemIdx !== -1 && args[pemIdx + 1]) cfg.pemOverride = args[pemIdx + 1];

let result;
if (target === 'railway') {
  result = await deployRailway(cfg);
} else {
  result = await deployAws(cfg);
}

/* -------------------------------- summary ------------------------------- */
section('Summary');
console.log(`
  ${pc.bold('URLs')}
    API:    ${pc.cyan(cfg.apiUrl)}  (health: ${cfg.apiUrl}/api/v1/health)
    Admin:  ${pc.cyan(cfg.adminUrl)}
`);
if (result.target === 'lightsail') {
  console.log(`  ${pc.bold('Credentials & access')}
    Server IP:        ${result.ip}
    SSH:              ssh -i ${result.pemPath} ubuntu@${result.ip}
    AWS profile:      pothole-deploy (~/.aws/credentials — your default profile untouched)
    Postgres:         user pothole, db potholes (password baked into apps/api/.env on the server)${
      result.s3.bucket
        ? `\n    S3 bucket:        ${result.s3.bucket}\n    S3 access key:    ${result.s3.accessKeyId} ${pc.yellow('(secret shown once — stored in the server .env)')}`
        : ''
    }
`);
} else {
  console.log(`  ${pc.bold('Credentials & access')}
    Railway project:  railway open   (dashboard)
    Variables:        set on the API service (secrets redacted in the log above)
`);
}

console.log(`  ${pc.bold('REMINDERS — do these now')}
  ${pc.yellow('1.')} Auth0 → SPA app (admin) — paste EXACTLY:
       Allowed Callback URLs:  ${cfg.adminUrl}
       Allowed Logout URLs:    ${cfg.adminUrl}
       Allowed Web Origins:    ${cfg.adminUrl}
  ${pc.yellow('2.')} Auth0 → Native app (mobile) — Allowed Callback/Logout URLs:
       potholecollect://${cfg.auth0Domain}/android/com.threemates.potholecollect/callback
       potholecollect://${cfg.auth0Domain}/ios/com.threemates.potholecollect/callback
     (+ enable the Google social connection on both apps)
  ${pc.yellow('3.')} First login: sign in to ${cfg.adminUrl} as ${pc.bold(cfg.adminEmail)}
     — the first user ever (or that email) becomes the approved primary admin.
  ${pc.yellow('4.')} Mobile app — paste into apps/mobile/app.json:
${pc.dim(`       "extra": {
         "apiUrl": "${cfg.apiUrl}",
         "auth0Domain": "${cfg.auth0Domain}",
         "auth0ClientId": "<native app client id>",
         "auth0Audience": "${cfg.auth0Audience}",
         "eas": { "projectId": "<from eas init>" }
       }`)}
     then: cd apps/mobile && npm run sync-shared && npx expo prebuild --clean
  ${pc.yellow('5.')} Resend: verify your sending domain (${cfg.mailFrom.replace(/^.*<|>.*$/g, '')})
     or signup/settlement mails will not deliver.
`);
/* ----------------------------- state cleanup ----------------------------- */
if (isDryRun()) {
  note(`[dry-run] state kept at ${stateFilePath()} — re-run to test resume, or use --fresh.`);
} else {
  const keep = await confirm('Keep the deploy state file for reference? (it contains secrets)', false);
  if (keep) {
    warn(`State kept at ${stateFilePath()} — mode 600, git-ignored. Delete it when done.`);
  } else {
    clearState();
    console.log(pc.green('  state cleared'));
  }
}

console.log(pc.green(pc.bold('  Done. Happy pothole hunting!\n')));
