import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export const config = {
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/potholes'),

  auth0Domain: env('AUTH0_DOMAIN'),
  auth0Audience: env('AUTH0_AUDIENCE'),
  devAuthBypass: env('DEV_AUTH_BYPASS') === '1',

  resendApiKey: env('RESEND_API_KEY'),
  mailFrom: env('MAIL_FROM', 'PotholeCollect <onboarding@resend.dev>'),
  adminEmail: env('ADMIN_EMAIL'),

  storageDir: path.resolve(env('STORAGE_DIR', './uploads')),

  googleServiceAccountJson: env('GOOGLE_SERVICE_ACCOUNT_JSON'),
  driveFolderId: env('DRIVE_FOLDER_ID'),

  corsOrigins: env('CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
