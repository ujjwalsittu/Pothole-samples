/**
 * AWS Lightsail path — automates docs/DEPLOYMENT.md §2b end to end.
 * Uses a DEDICATED aws-cli profile (pothole-deploy) so the user's existing
 * AWS logins are never touched or leaked into this deployment.
 */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pc from 'picocolors';
import { run, runCapture, scp, ssh, which } from './exec.mjs';
import { buildProvisionScript } from './remote.mjs';
import { getArtifact, isStepDone, setArtifact } from './state.mjs';
import {
  confirm,
  highlightBlock,
  isDryRun,
  note,
  pressEnter,
  runStep,
  section,
  select,
  skipStep,
  warn,
} from './ui.mjs';

let PROFILE = 'pothole-deploy'; // overridden when the user picks an existing profile
const DOCS = 'docs/DEPLOYMENT.md §2b';
const INSTANCE = 'pothole-server';
const STATIC_IP = 'pothole-ip';
const KEY_NAME = 'pothole-deploy-key';
const IAM_USER = 'pothole-app';
const DRY_IP = '203.0.113.10';

/** Treat AlreadyExists-style AWS errors as success (idempotent re-runs). */
const EXISTS_RE =
  /already ?(exists|owned|in ?use|attached)|BucketAlreadyOwnedByYou|BucketAlreadyExists|EntityAlreadyExists|Duplicate/i;
function tolerateExists(fn, what) {
  try {
    return fn();
  } catch (err) {
    if (EXISTS_RE.test(String(err?.message ?? err))) {
      note(`${what} already exists — reusing it.`);
      return null;
    }
    throw err;
  }
}

const FALLBACK_BUNDLES = [
  { id: 'micro_3_0', price: 7, ram: 1, cpu: 2 },
  { id: 'small_3_0', price: 12, ram: 2, cpu: 2 },
  { id: 'medium_3_0', price: 24, ram: 4, cpu: 2 },
  { id: 'large_3_0', price: 44, ram: 8, cpu: 2 },
];

export async function deployAws(cfg) {
  section('AWS — CLI check');
  if (!which('aws')) {
    console.log(pc.red('  aws CLI not found.'));
    console.log(pc.bold('    brew install awscli'));
    if (!isDryRun()) process.exit(1);
    note('dry-run: continuing anyway.');
  }

  const aws = (args, opts = {}) =>
    runCapture('aws', [...args, '--profile', PROFILE, '--region', cfg.region, '--output', 'json'], opts);

  /* -------- fresh, isolated credentials -------- */
  const method = cfg.awsAuthMethod ?? 'keys';
  if (method === 'profile') PROFILE = cfg.awsProfile || 'default';

  section('AWS — authentication');
  if (method === 'keys') {
    note(`Credentials go into the aws-cli profile "${PROFILE}" — your default profile and any`);
    note('existing AWS sessions are left untouched (that IS the fresh-auth guarantee here).');
    await runStep(
      `Write profile ${PROFILE}`,
      () => {
        runCapture('aws', ['configure', 'set', 'aws_access_key_id', cfg.awsAccessKeyId, '--profile', PROFILE], {
          redact: [cfg.awsAccessKeyId],
        });
        runCapture(
          'aws',
          ['configure', 'set', 'aws_secret_access_key', cfg.awsSecretAccessKey, '--profile', PROFILE],
          { redact: [cfg.awsSecretAccessKey] },
        );
        runCapture('aws', ['configure', 'set', 'region', cfg.region, '--profile', PROFILE]);
      },
      { manual: `aws configure --profile ${PROFILE}`, docs: DOCS },
    );
  } else if (method === 'sso') {
    note(`Browser login via IAM Identity Center, still isolated in profile "${PROFILE}".`);
    note('Your browser will open — pick the account/role to deploy with.');
    await runStep(
      `Configure SSO profile ${PROFILE} (interactive)`,
      () => {
        // Interactive: prompts for the SSO start URL / account / role, opens
        // the browser, and leaves a ready-to-use profile behind.
        run('aws', ['configure', 'sso', '--profile', PROFILE]);
        runCapture('aws', ['configure', 'set', 'region', cfg.region, '--profile', PROFILE]);
      },
      { manual: `aws configure sso --profile ${PROFILE}`, docs: DOCS },
    );
    // alwaysRun: SSO sessions expire — refresh on every launch.
    await runStep(
      'SSO login (refresh session if needed)',
      () => run('aws', ['sso', 'login', '--profile', PROFILE]),
      { manual: `aws sso login --profile ${PROFILE}`, optional: true, alwaysRun: true },
    );
  } else {
    note(`Using your existing aws-cli profile "${PROFILE}" as-is (no credentials written).`);
  }
  await runStep(
    'Validate credentials (sts get-caller-identity)',
    () => {
      const out = aws(['sts', 'get-caller-identity']);
      if (out) note(`Account: ${JSON.parse(out).Account}`);
    },
    { manual: `aws sts get-caller-identity --profile ${PROFILE}`, alwaysRun: true },
  );

  /* -------- plan picker -------- */
  section('Lightsail — instance plan');
  let bundleId = getArtifact('bundleId');
  if (bundleId) {
    note(`Reusing plan from previous run: ${bundleId}`);
  } else {
    let bundles = FALLBACK_BUNDLES;
    await runStep(
      'Fetch available bundles',
      () => {
        const out = aws([
          'lightsail',
          'get-bundles',
          '--query',
          "bundles[?isActive && contains(supportedPlatforms, 'LINUX_UNIX')].{id:bundleId,price:price,ram:ramSizeInGb,cpu:cpuCount}",
        ]);
        if (out) {
          const parsed = JSON.parse(out);
          if (Array.isArray(parsed) && parsed.length > 0) bundles = parsed;
        }
      },
      { manual: `aws lightsail get-bundles --profile ${PROFILE}`, optional: true },
    );
    const recommendedIdx = Math.max(
      0,
      bundles.findIndex((b) => Number(b.ram) === (cfg.installDocker ? 4 : 2)),
    );
    bundleId = await select(
      `Instance plan${cfg.installDocker ? ' (4 GB recommended — OSRM preprocessing on-box)' : ' (2 GB recommended)'}`,
      bundles.map((b) => ({
        title: `$${b.price}/mo — ${b.ram} GB RAM, ${b.cpu} vCPU (${b.id})`,
        value: b.id,
      })),
      recommendedIdx,
    );
    setArtifact('bundleId', bundleId);
  }

  /* -------- storage: S3 + IAM (optional) -------- */
  const s3 = { bucket: null, accessKeyId: null, secretAccessKey: null };
  if (cfg.storageChoice === 's3') {
    section('S3 + IAM (media storage)');
    // The random suffix MUST survive restarts — persist it before creating.
    let bucket = getArtifact('s3Bucket');
    if (!bucket) {
      bucket = `pothole-media-${crypto.randomBytes(3).toString('hex')}`;
      setArtifact('s3Bucket', bucket);
    } else {
      note(`Reusing bucket name from previous run: ${bucket}`);
    }
    await runStep(
      `Create bucket ${bucket} (${cfg.region})`,
      () =>
        tolerateExists(() => {
          const args = ['s3api', 'create-bucket', '--bucket', bucket];
          // us-east-1 must NOT send a LocationConstraint.
          if (cfg.region !== 'us-east-1') {
            args.push('--create-bucket-configuration', `LocationConstraint=${cfg.region}`);
          }
          aws(args);
        }, `Bucket ${bucket}`),
      { manual: `aws s3api create-bucket --bucket ${bucket} --profile ${PROFILE}`, docs: DOCS },
    );
    await runStep(
      'Block public access on the bucket',
      () =>
        aws([
          's3api',
          'put-public-access-block',
          '--bucket',
          bucket,
          '--public-access-block-configuration',
          'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
        ]),
      { manual: `aws s3api put-public-access-block --bucket ${bucket} …` },
    );
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            's3:PutObject',
            's3:GetObject',
            's3:DeleteObject',
            's3:AbortMultipartUpload',
            's3:ListMultipartUploadParts',
          ],
          Resource: `arn:aws:s3:::${bucket}/*`,
        },
      ],
    });
    await runStep(
      `Create IAM user ${IAM_USER} + minimal bucket policy`,
      () => {
        aws(['iam', 'create-user', '--user-name', IAM_USER], { allowFail: true }); // may exist
        aws(['iam', 'put-user-policy', '--user-name', IAM_USER, '--policy-name', 'pothole-media', '--policy-document', policy]);
      },
      { manual: `aws iam create-user --user-name ${IAM_USER} --profile ${PROFILE}` },
    );
    await runStep(
      'Create access key for the API server',
      () => {
        const out = aws(['iam', 'create-access-key', '--user-name', IAM_USER]);
        if (out) {
          const k = JSON.parse(out).AccessKey;
          s3.accessKeyId = k.AccessKeyId;
          s3.secretAccessKey = k.SecretAccessKey;
        } else {
          s3.accessKeyId = 'DRYRUNACCESSKEY';
          s3.secretAccessKey = 'DRYRUNSECRETKEY';
        }
        // These CANNOT be re-fetched from AWS — persist immediately.
        setArtifact('s3AccessKeyId', s3.accessKeyId);
        setArtifact('s3SecretAccessKey', s3.secretAccessKey);
      },
      { manual: `aws iam create-access-key --user-name ${IAM_USER} --profile ${PROFILE}` },
    );
    // On resume the step above is skipped — recover the persisted key.
    s3.accessKeyId = getArtifact('s3AccessKeyId') ?? s3.accessKeyId;
    s3.secretAccessKey = getArtifact('s3SecretAccessKey') ?? s3.secretAccessKey;
    s3.bucket = bucket;
    cfg.s3Bucket = bucket;
    cfg.s3Region = cfg.region;
    cfg.s3Endpoint = '';
    cfg.s3AccessKeyId = s3.accessKeyId;
    cfg.s3SecretAccessKey = s3.secretAccessKey;
  } else {
    skipStep('S3 bucket + IAM user', 'local-disk storage chosen (Lightsail disk is persistent)');
  }

  /* -------- instance -------- */
  section('Lightsail — instance');
  let blueprint = getArtifact('blueprintId') ?? 'ubuntu_24_04';
  await runStep(
    'Verify Ubuntu 24.04 blueprint',
    () => {
      const out = aws([
        'lightsail',
        'get-blueprints',
        '--query',
        "blueprints[?contains(blueprintId, 'ubuntu')].blueprintId",
      ]);
      if (out) {
        const ids = JSON.parse(out);
        if (!ids.includes(blueprint)) {
          const alt = ids.sort().reverse()[0];
          warn(`ubuntu_24_04 not listed; using ${alt}`);
          blueprint = alt;
        }
      }
      setArtifact('blueprintId', blueprint);
    },
    { manual: `aws lightsail get-blueprints --profile ${PROFILE}`, optional: true },
  );

  /* -------- SSH key (BEFORE instance creation so it can be attached) -------- */
  section('SSH key');
  let pemPath = path.join(os.homedir(), '.ssh', `${KEY_NAME}.pem`);
  // 'created' → our named key pair exists in Lightsail and can be passed to
  // create-instances; 'default' → we only hold the region default key.
  let keySource = getArtifact('keySource') ?? 'created';
  if (fs.existsSync(pemPath) && getArtifact('keySource')) {
    skipStep(`Create key pair ${KEY_NAME}`, `reusing existing ${pemPath} (${keySource})`);
  } else {
    await runStep(`Create key pair ${KEY_NAME} → ${pemPath}`, () => {
      let out = aws(['lightsail', 'create-key-pair', '--key-pair-name', KEY_NAME], { allowFail: true });
      keySource = 'created';
      if (!out) {
        // Name may exist without a local pem, or creation failed → use the
        // region default key (create-instances then must NOT name a key).
        out = aws(['lightsail', 'download-default-key-pair']);
        keySource = 'default';
      }
      if (isDryRun()) return;
      const pem = JSON.parse(out).privateKeyBase64;
      if (!pem) throw new Error('no privateKeyBase64 in response');
      fs.mkdirSync(path.dirname(pemPath), { recursive: true });
      fs.writeFileSync(pemPath, pem, { mode: 0o600 });
    }, { manual: `aws lightsail create-key-pair --key-pair-name ${KEY_NAME} --profile ${PROFILE}` });
  }
  setArtifact('pemPath', pemPath);
  setArtifact('keySource', keySource);

  // No re-confirmation when the create step already succeeded in a prior run.
  if (!isStepDone(`Create instance ${INSTANCE}`)) {
    const confirmCreate = await confirm(
      `Create Lightsail instance "${INSTANCE}" (${bundleId}, ${blueprint}, ${cfg.availabilityZone})? This starts billing.`,
      true,
    );
    if (!confirmCreate) {
      console.log(pc.red('Instance creation declined — aborting (nothing created).'));
      process.exit(1);
    }
  }
  await runStep(
    `Create instance ${INSTANCE}`,
    () =>
      tolerateExists(
        () =>
          aws([
            'lightsail',
            'create-instances',
            '--instance-names',
            INSTANCE,
            '--availability-zone',
            cfg.availabilityZone,
            '--blueprint-id',
            blueprint,
            '--bundle-id',
            bundleId,
            // Attach OUR key pair — without this the instance gets the
            // region default key and ssh with our pem is refused.
            ...(keySource === 'created' ? ['--key-pair-name', KEY_NAME] : []),
          ]),
        `Instance ${INSTANCE}`,
      ),
    { manual: `aws lightsail create-instances --instance-names ${INSTANCE} --availability-zone ${cfg.availabilityZone} --blueprint-id ${blueprint} --bundle-id ${bundleId} --profile ${PROFILE}`, docs: DOCS },
  );

  await runStep('Wait for instance to be running (≤5 min)', async () => {
    if (isDryRun()) return;
    const deadline = Date.now() + 5 * 60 * 1000;
    for (;;) {
      const out = aws(['lightsail', 'get-instance', '--instance-name', INSTANCE, '--query', 'instance.state.name']);
      const state = out ? JSON.parse(out) : 'unknown';
      if (state === 'running') return;
      if (Date.now() > deadline) throw new Error(`instance still "${state}" after 5 minutes`);
      process.stdout.write(pc.dim(`    state=${state}, retrying in 5 s…\r`));
      await new Promise((r) => setTimeout(r, 5000));
    }
  });

  for (const port of [443, 80]) {
    await runStep(
      `Open port ${port}`,
      () =>
        aws([
          'lightsail',
          'open-instance-public-ports',
          '--instance-name',
          INSTANCE,
          '--port-info',
          `fromPort=${port},toPort=${port},protocol=TCP`,
        ]),
      { manual: `aws lightsail open-instance-public-ports --instance-name ${INSTANCE} --port-info fromPort=${port},toPort=${port},protocol=TCP --profile ${PROFILE}` },
    );
  }

  let ip = getArtifact('staticIp') ?? DRY_IP;
  await runStep('Allocate + attach static IP', () => {
    aws(['lightsail', 'allocate-static-ip', '--static-ip-name', STATIC_IP], { allowFail: true }); // may exist
    tolerateExists(
      () => aws(['lightsail', 'attach-static-ip', '--static-ip-name', STATIC_IP, '--instance-name', INSTANCE]),
      `Static IP attachment`,
    );
    const out = aws(['lightsail', 'get-static-ip', '--static-ip-name', STATIC_IP, '--query', 'staticIp.ipAddress']);
    if (out) ip = JSON.parse(out);
    setArtifact('staticIp', ip);
  }, { manual: `aws lightsail allocate-static-ip --static-ip-name ${STATIC_IP} --profile ${PROFILE}` });

  console.log('');
  highlightBlock([`SERVER IP: ${ip}`]);

  /* -------- DNS -------- */
  section('DNS');
  console.log(`  Create these ${pc.bold('A records')} at your DNS provider now:
    ${pc.bold(cfg.apiDomain.padEnd(36))} A  →  ${ip}
    ${pc.bold(cfg.adminDomain.padEnd(36))} A  →  ${ip}
`);
  await pressEnter('Done creating both A records?');
  if (isDryRun()) {
    skipStep('DNS propagation check', 'dry-run');
  } else {
    const verify = await confirm('Verify DNS propagation now (12 tries × 10 s)?', true);
    if (verify) {
      // alwaysRun: DNS must be re-verified on every launch — records may
      // have changed or expired between runs.
      await runStep('Resolve both hostnames to the server IP', async () => {
        for (let i = 1; i <= 12; i++) {
          try {
            const [a, b] = await Promise.all([dns.resolve4(cfg.apiDomain), dns.resolve4(cfg.adminDomain)]);
            if (a.includes(ip) && b.includes(ip)) return;
            throw new Error(`resolved to ${a.join(',')} / ${b.join(',')}`);
          } catch (err) {
            if (i === 12) throw new Error(`DNS not propagated yet (${err.message})`);
            process.stdout.write(pc.dim(`    attempt ${i}/12 failed, retrying in 10 s…\r`));
            await new Promise((r) => setTimeout(r, 10_000));
          }
        }
      }, { alwaysRun: true });
    } else {
      skipStep('DNS propagation check', 'skipped — certbot WILL fail until both records resolve');
    }
  }

  /* -------- provision -------- */
  section('Server provisioning (docs/DEPLOYMENT.md §2b over SSH)');

  // Probe SSH and pick the key that actually opens the instance. Instances
  // created by OLDER versions of this CLI (or by hand) may carry the REGION
  // DEFAULT key instead of pothole-deploy-key — fall back to it automatically.
  await runStep('Verify SSH access (select working key)', async () => {
    if (isDryRun()) return;
    const probe = (pem) => {
      try {
        ssh(pem, ip, 'true');
        return true;
      } catch {
        return false;
      }
    };
    if (probe(pemPath)) return;
    warn(`ssh with ${pemPath} was refused — trying the region default key…`);
    const defPem = path.join(os.homedir(), '.ssh', `lightsail-default-${cfg.region}.pem`);
    if (!fs.existsSync(defPem)) {
      const out = aws(['lightsail', 'download-default-key-pair']);
      const pem = JSON.parse(out).privateKeyBase64;
      if (!pem) throw new Error('no privateKeyBase64 in download-default-key-pair response');
      fs.writeFileSync(defPem, pem, { mode: 0o600 });
    }
    if (!probe(defPem)) {
      throw new Error(
        `neither ${pemPath} nor the region default key opens ubuntu@${ip} — ` +
          `check the instance's key pair in the Lightsail console`,
      );
    }
    pemPath = defPem;
    setArtifact('pemPath', pemPath);
    note(`Using region default key: ${defPem}`);
  }, {
    manual: `ssh -i ${pemPath} ubuntu@${ip} true   # then: aws lightsail download-default-key-pair --profile ${PROFILE}`,
    alwaysRun: true,
  });
  // The generated Postgres password MUST be stable across resumes — the DB
  // user is created once, and .env must keep matching it.
  cfg.pgPassword = getArtifact('pgPassword') ?? crypto.randomBytes(12).toString('hex');
  setArtifact('pgPassword', cfg.pgPassword);
  const script = buildProvisionScript(cfg);
  if (isDryRun()) {
    console.log(pc.yellow('  [dry-run] generated provisioning script:\n'));
    console.log(
      script
        .split('\n')
        .map((l) => pc.dim('    │ ') + l)
        .join('\n'),
    );
  }
  const scriptLocal = path.join(os.tmpdir(), `pothole-provision-${Date.now()}.sh`);
  await runStep('Write provisioning script locally', () => {
    if (isDryRun()) return;
    fs.writeFileSync(scriptLocal, script, { mode: 0o700 });
  });
  await runStep(
    'Upload script to the server',
    () => scp(pemPath, isDryRun() ? '<provision.sh>' : scriptLocal, ip, '/tmp/pothole-provision.sh'),
    { manual: `scp -i ${pemPath} ${scriptLocal} ubuntu@${ip}:/tmp/pothole-provision.sh` },
  );
  await runStep(
    'Run provisioning (apt, node, postgres, clone, .env, migrate, systemd, nginx, certbot)',
    () => ssh(pemPath, ip, 'sudo bash /tmp/pothole-provision.sh'),
    {
      manual: `ssh -i ${pemPath} ubuntu@${ip} 'sudo bash /tmp/pothole-provision.sh'`,
      docs: DOCS,
    },
  );

  /* -------- verify from this machine -------- */
  section('Final verification');
  await runStep(`GET ${cfg.apiUrl}/api/v1/health`, async () => {
    if (isDryRun()) return;
    for (let i = 1; i <= 6; i++) {
      try {
        const res = await fetch(`${cfg.apiUrl}/api/v1/health`, { signal: AbortSignal.timeout(10_000) });
        const body = await res.json();
        if (body?.ok === true) {
          note(`health: ${JSON.stringify(body.data ?? body)}`);
          return;
        }
        throw new Error(`unexpected body: ${JSON.stringify(body).slice(0, 120)}`);
      } catch (err) {
        if (i === 6) throw err;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }, { manual: `curl -s ${cfg.apiUrl}/api/v1/health`, alwaysRun: true });

  return { target: 'lightsail', ip, pemPath, s3, pgPassword: cfg.pgPassword };
}
