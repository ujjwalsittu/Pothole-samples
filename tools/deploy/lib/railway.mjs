/**
 * Railway path — automates docs/DEPLOYMENT.md §1–2. Railway CLI syntax
 * varies between versions, so EVERY invocation goes through runStep and a
 * failure prints the manual command + doc reference instead of crashing.
 */
import pc from 'picocolors';
import { run, which } from './exec.mjs';
import { getArtifact, setArtifact } from './state.mjs';
import { isDryRun, note, runStep, section, select, skipStep, warn } from './ui.mjs';

const DOCS = 'docs/DEPLOYMENT.md §1–2';

export async function deployRailway(cfg) {
  section('Railway — CLI check');
  if (!which('railway')) {
    console.log(pc.red('  railway CLI not found.'));
    console.log(pc.bold('    brew install railway') + pc.dim('   (or: npm i -g @railway/cli)'));
    if (!isDryRun()) process.exit(1);
    note('dry-run: continuing anyway.');
  }

  section('Railway — authentication (fresh login)');
  // alwaysRun: authentication must be refreshed on every launch.
  await runStep(
    'Log out any existing Railway session',
    () => run('railway', ['logout'], { allowFail: true }),
    { manual: 'railway logout', docs: DOCS, alwaysRun: true },
  );
  await runStep('Log in to Railway (browser opens)', () => run('railway', ['login']), {
    manual: 'railway login',
    docs: DOCS,
    alwaysRun: true,
  });

  section('Railway — project');
  let mode = getArtifact('railwayMode');
  if (mode) {
    note(`Reusing project mode from previous run: railway ${mode}`);
  } else {
    mode = await select('Project', [
      { title: 'Create a new Railway project (railway init)', value: 'init' },
      { title: 'Link an existing project (railway link)', value: 'link' },
    ]);
    setArtifact('railwayMode', mode);
  }
  await runStep(
    mode === 'init' ? 'Create project (railway init)' : 'Link project (railway link)',
    () => {
      run('railway', [mode]);
      setArtifact('railwayLinked', true);
    },
    { manual: `railway ${mode}`, docs: DOCS },
  );

  await runStep(
    'Provision PostgreSQL (railway add --database postgres)',
    () => run('railway', ['add', '--database', 'postgres']),
    {
      manual: 'Railway dashboard → New → Database → PostgreSQL (then re-run or continue)',
      docs: `${DOCS} (§1.1)`,
    },
  );

  section('Railway — API environment variables');
  note('Railway disk is ephemeral → STORAGE_DRIVER=s3 with your existing bucket (§1.4).');
  const vars = [
    ['DATABASE_URL', '${{Postgres.DATABASE_URL}}'],
    ['AUTH0_DOMAIN', cfg.auth0Domain],
    ['AUTH0_AUDIENCE', cfg.auth0Audience],
    ['MAIL_FROM', cfg.mailFrom],
    ['ADMIN_EMAIL', cfg.adminEmail],
    ['CORS_ORIGINS', `https://${cfg.adminDomain}`],
    ['STORAGE_DRIVER', 's3'],
    ['S3_BUCKET', cfg.s3Bucket],
    ['S3_REGION', cfg.s3Region],
    ['AWS_ACCESS_KEY_ID', cfg.s3AccessKeyId],
    ['AWS_SECRET_ACCESS_KEY', cfg.s3SecretAccessKey, true],
  ];
  if (cfg.resendApiKey) vars.push(['RESEND_API_KEY', cfg.resendApiKey, true]);
  else skipStep('RESEND_API_KEY', 'not provided — mail disabled');
  if (cfg.s3Endpoint) vars.push(['S3_ENDPOINT', cfg.s3Endpoint]);

  for (const [key, value, sensitive] of vars) {
    await runStep(
      `Set ${key}`,
      () =>
        run('railway', ['variables', '--set', `${key}=${value}`], {
          redact: sensitive ? [value] : [],
        }),
      { manual: `railway variables --set '${key}=${sensitive ? '<value>' : value}'`, docs: `${DOCS} (§1.2)` },
    );
  }

  section('Railway — deploy');
  note('Service settings to confirm in the dashboard (Settings → Build):');
  note('  Build:  npm install && npm run build --workspace apps/api');
  note('  Start:  npm run migrate --workspace apps/api && npm run start --workspace apps/api');
  await runStep('Deploy (railway up)', () => run('railway', ['up']), {
    manual: 'railway up',
    docs: `${DOCS} (§1.1)`,
  });

  section('Railway — domains');
  await runStep('Generate a railway.app domain (railway domain)', () => run('railway', ['domain']), {
    manual: 'railway domain   (or dashboard → Settings → Networking → Generate Domain)',
    docs: `${DOCS} (§1.3)`,
  });
  console.log(`
  ${pc.bold('Custom domain (dashboard → API service → Settings → Networking):')}
    1. + Custom Domain → ${pc.bold(cfg.apiDomain)}
    2. Add the CNAME record Railway shows at your DNS provider.
    3. TLS is automatic once the CNAME resolves.
`);

  warn('Admin dashboard runs as a SECOND Railway service (cannot be fully scripted here):');
  console.log(`    New Service → same GitHub repo, then:
      Build:  npm install && npm run build --workspace apps/admin
      Start:  npx serve apps/admin/dist -s -l $PORT
      Vars:   VITE_API_URL=${cfg.apiUrl}
              VITE_AUTH0_DOMAIN=${cfg.auth0Domain}
              VITE_AUTH0_CLIENT_ID=${cfg.auth0SpaClientId}
              VITE_AUTH0_AUDIENCE=${cfg.auth0Audience}
      Custom domain: ${cfg.adminDomain} (CNAME, as above) — see ${DOCS} (§2)
`);

  return { target: 'railway' };
}
