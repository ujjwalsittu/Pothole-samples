/**
 * Interactive credential/config questionnaire. Everything validated, with
 * sensible defaults. Returns one config object consumed by both paths.
 */
import { runCapture } from './exec.mjs';
import { secret, section, select, text, validators, warn } from './ui.mjs';

const FALLBACK_REPO = 'https://github.com/ujjwalsittu/Pothole-samples.git';

function detectRepoUrl() {
  try {
    return runCapture('git', ['remote', 'get-url', 'origin'], { allowFail: true }) || FALLBACK_REPO;
  } catch {
    return FALLBACK_REPO;
  }
}

/** Common questions for both targets. */
export async function collectCommon() {
  section('Domains');
  const baseDomain = await text('Base domain (e.g. potholes.example.com)', {
    validate: validators.domain,
  });
  const apiDomain = await text('API domain', {
    initial: `api.${baseDomain}`,
    validate: validators.domain,
  });
  const adminDomain = await text('Admin dashboard domain', {
    initial: `admin.${baseDomain}`,
    validate: validators.domain,
  });

  section('Auth0');
  const auth0Domain = await text('Auth0 tenant domain (your-tenant.auth0.com)', {
    validate: validators.domain,
  });
  const auth0Audience = await text('Auth0 API audience (identifier)', {
    initial: `https://${apiDomain}`,
    validate: validators.url,
  });
  const auth0SpaClientId = await text('Auth0 SPA (admin dashboard) client id', {
    validate: validators.nonEmpty,
  });

  section('Mail (Resend)');
  const resendApiKey = await secret('Resend API key', { optional: true });
  if (!resendApiKey) warn('No Resend key — transactional mail will be disabled (logged only).');
  const mailFrom = await text('MAIL_FROM', {
    initial: `PotholeCollect <no-reply@${baseDomain}>`,
    validate: validators.nonEmpty,
  });
  const adminEmail = await text('ADMIN_EMAIL (primary admin, gets signup alerts)', {
    initial: 'ujjwal@threemates.tech',
    validate: validators.email,
  });

  section('Misc');
  const leEmail = await text("Let's Encrypt / ops email (certbot notifications)", {
    initial: adminEmail,
    validate: validators.email,
  });
  const repoUrl = await text('Git repository URL (cloned on the server)', {
    initial: detectRepoUrl(),
    validate: validators.nonEmpty,
  });

  return {
    baseDomain,
    apiDomain,
    adminDomain,
    apiUrl: `https://${apiDomain}`,
    adminUrl: `https://${adminDomain}`,
    auth0Domain,
    auth0Audience,
    auth0SpaClientId,
    resendApiKey,
    mailFrom,
    adminEmail,
    leEmail,
    repoUrl,
  };
}

/**
 * Railway-only: existing S3/R2 bucket credentials — Railway disk is
 * ephemeral, so S3 storage is required there (docs/DEPLOYMENT.md §1.4).
 */
export async function collectRailwayStorage() {
  section('Object storage (required on Railway — ephemeral disk)');
  const s3Bucket = await text('S3/R2 bucket name', { validate: validators.nonEmpty });
  const s3Region = await text('Bucket region', { initial: 'ap-south-1', validate: validators.nonEmpty });
  const s3Endpoint = await text('Custom endpoint (R2/Spaces/MinIO; empty for AWS S3)', {
    initial: '',
  });
  const s3AccessKeyId = await text('Storage access key id', { validate: validators.nonEmpty });
  const s3SecretAccessKey = await secret('Storage secret access key', {
    validate: validators.nonEmpty,
  });
  return { s3Bucket, s3Region, s3Endpoint, s3AccessKeyId, s3SecretAccessKey };
}

/** Lightsail-only extras. */
export async function collectAwsBasics() {
  section('AWS credentials (written to a DEDICATED profile)');
  const awsAccessKeyId = await text('AWS Access Key ID', { validate: validators.nonEmpty });
  const awsSecretAccessKey = await secret('AWS Secret Access Key', {
    validate: validators.nonEmpty,
  });

  const region = await select(
    'Lightsail region',
    [
      { title: 'ap-south-1 (Mumbai) — recommended', value: 'ap-south-1' },
      { title: 'us-east-1 (N. Virginia)', value: 'us-east-1' },
      { title: 'eu-west-1 (Ireland)', value: 'eu-west-1' },
      { title: 'ap-southeast-1 (Singapore)', value: 'ap-southeast-1' },
      { title: 'us-west-2 (Oregon)', value: 'us-west-2' },
    ],
    0,
  );
  const availabilityZone = await text('Availability zone', {
    initial: `${region}a`,
    validate: validators.nonEmpty,
  });

  const storageChoice = await select(
    'Media storage',
    [
      { title: 'Local disk on the instance (simplest — Lightsail disk is persistent)', value: 'local' },
      { title: 'Create an S3 bucket + IAM user (media off-box)', value: 's3' },
    ],
    0,
  );

  const installDocker = await select(
    'Install Docker on the server (needed only for the OSRM admin panel)?',
    [
      { title: 'No', value: false },
      { title: 'Yes — I want in-panel OSRM (pick a 4 GB plan)', value: true },
    ],
    0,
  );

  return { awsAccessKeyId, awsSecretAccessKey, region, availabilityZone, storageChoice, installDocker };
}
