import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { PRIMARY_ADMIN_EMAIL } from '@pothole/shared';
import { query, withTransaction } from '../db/pool';
import { rowToPackage, rowToUser } from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { acceptedDaysForUser, computeStreaks } from '../services/gamification';
import { mail } from '../services/mail';
import { extForMime, saveBuffer } from '../services/storage';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** Multipart fields arrive as strings; parse embedded JSON when present. */
const jsonField = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v === 'string' && v.trim() !== '') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  }, schema);

const boolField = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', '1', 'yes', 'on'].includes(v.toLowerCase()) : v),
  z.boolean(),
);

const signupSchema = z.object({
  fullName: z.string().trim().min(1, 'fullName is required'),
  collectorStatus: z.enum(['student', 'professional', 'self']),
  organization: z.string().trim().max(200).optional(),
  mobile: z
    .string()
    .trim()
    .regex(/^\+?\d{10,15}$/, 'mobile must be 10-15 digits'),
  whatsappAvailable: boolField.optional(),
  signupLocation: jsonField(
    z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), acc: z.number() }),
  ).optional(),
  deviceFingerprint: jsonField(z.record(z.unknown())).optional(),
});

export const usersRouter = Router();

/**
 * POST /auth/signup-complete — multipart: fullName, collectorStatus
 * (student|professional|self), organization (required for students),
 * mobile, whatsappAvailable, signupLocation?, deviceFingerprint? + optional
 * `photo` file. No UPI at signup (captured at first withdrawal). Creates the
 * pending_approval user from the token identity; idempotent.
 *
 * PRIMARY ADMIN BOOTSTRAP: the very first user, or the PRIMARY_ADMIN_EMAIL,
 * signs up directly as an approved 'owner'.
 */
usersRouter.post(
  '/auth/signup-complete',
  upload.single('photo'),
  asyncH(async (req, res) => {
    const authInfo = req.authInfo;
    if (!authInfo) throw new ApiError(401, 'UNAUTHORIZED', 'Not authenticated');

    if (req.user) return ok(res, req.user); // idempotent

    const body = signupSchema.parse(req.body);
    if (body.collectorStatus === 'student' && !body.organization) {
      throw new ApiError(400, 'ORGANIZATION_REQUIRED', 'College/University is required for students');
    }
    const email = authInfo.email;
    if (!email) {
      throw new ApiError(400, 'EMAIL_REQUIRED', 'Token does not contain an email claim');
    }

    let photoUrl: string | null = null;
    if (req.file) {
      const rel = `profiles/${uuidv4()}.${extForMime(req.file.mimetype)}`;
      await saveBuffer(rel, req.file.buffer);
      photoUrl = rel;
    }

    const user = await withTransaction(async (client) => {
      // Serialize the "is the table empty" bootstrap check.
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const count = await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM users');
      const isPrimaryAdmin =
        Number(count.rows[0].n) === 0 || email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();

      const { rows } = await client.query(
        `INSERT INTO users
           (auth0_sub, email, full_name, photo_url, collector_status, organization, mobile,
            whatsapp_available, signup_lat, signup_lng, signup_acc, device_fingerprint,
            role, account_state, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (auth0_sub) DO UPDATE SET auth0_sub = EXCLUDED.auth0_sub
         RETURNING *`,
        [
          authInfo.sub,
          email,
          body.fullName,
          photoUrl,
          body.collectorStatus,
          body.organization ?? null,
          body.mobile,
          body.whatsappAvailable ?? false,
          body.signupLocation?.lat ?? null,
          body.signupLocation?.lng ?? null,
          body.signupLocation?.acc ?? null,
          body.deviceFingerprint ? JSON.stringify(body.deviceFingerprint) : null,
          isPrimaryAdmin ? 'owner' : 'collector',
          isPrimaryAdmin ? 'approved' : 'pending_approval',
          isPrimaryAdmin ? new Date() : null,
        ],
      );
      return rowToUser(rows[0]);
    });

    void mail.signupReceived(user.email, user.fullName);
    if (user.accountState === 'pending_approval') {
      void mail.newSignupAdminAlert(user.fullName, user.email, user.collectorStatus);
    }

    ok(res, user, 201);
  }),
);

/** GET /me — 404 USER_NOT_REGISTERED when no row exists yet. Includes the
 * user's full PackageInfo as `package`.
 *
 * PRIMARY-ADMIN WEB BOOTSTRAP: the mobile app registers users via
 * signup-complete, but the admin dashboard has no signup by design — so the
 * very first user, or PRIMARY_ADMIN_EMAIL, is auto-provisioned as an
 * approved owner right here on first login from the web. */
usersRouter.get(
  '/me',
  asyncH(async (req, res) => {
    let user = req.user ?? null;

    if (!user) {
      const authInfo = req.authInfo;
      if (!authInfo) throw new ApiError(401, 'UNAUTHORIZED', 'Not authenticated');
      const email = authInfo.email ?? null;

      user = await withTransaction(async (client) => {
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const count = await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM users');
        const isPrimaryAdmin =
          Number(count.rows[0].n) === 0 ||
          (email !== null && email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase());
        if (!isPrimaryAdmin) return null;

        const fullName = email ? email.split('@')[0] : 'Primary Admin';
        const { rows } = await client.query(
          `INSERT INTO users
             (auth0_sub, email, full_name, collector_status, mobile, role, account_state, approved_at)
           VALUES ($1,$2,$3,'professional',NULL,'owner','approved',now())
           ON CONFLICT (auth0_sub) DO UPDATE SET auth0_sub = EXCLUDED.auth0_sub
           RETURNING *`,
          [authInfo.sub, email ?? `${authInfo.sub}@unknown.local`, fullName],
        );
        return rowToUser(rows[0]);
      });
      if (!user) {
        throw new ApiError(404, 'USER_NOT_REGISTERED', 'Complete signup in the mobile app first');
      }
    }

    const { rows } = await query('SELECT * FROM packages WHERE code = $1', [user.packageCode]);
    ok(res, { ...user, package: rows[0] ? rowToPackage(rows[0]) : null });
  }),
);

/** POST /me/push-token — register an Expo push token for this user. */
usersRouter.post(
  '/me/push-token',
  requireUser,
  asyncH(async (req, res) => {
    const body = z
      .object({ token: z.string().trim().min(8), platform: z.string().trim().max(32).optional() })
      .parse(req.body ?? {});
    await query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $3, updated_at = now()`,
      [req.user!.id, body.token, body.platform ?? null],
    );
    ok(res, { registered: true });
  }),
);

/** GET /me/streak — current + best accepted-sample day streaks. */
usersRouter.get(
  '/me/streak',
  requireUser,
  asyncH(async (req, res) => {
    const days = await acceptedDaysForUser(req.user!.id);
    ok(res, computeStreaks(days));
  }),
);

const patchMeSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  upiId: z.string().trim().min(3).optional(),
});

/** PATCH /me — fullName / upiId (collectors only) + optional `photo` file. */
usersRouter.patch(
  '/me',
  requireUser,
  upload.single('photo'),
  asyncH(async (req, res) => {
    const user = req.user!;
    const body = patchMeSchema.parse(req.body ?? {});
    if (body.upiId !== undefined && !user.isCollector) {
      throw new ApiError(403, 'NOT_A_COLLECTOR', 'Only collectors can set a UPI ID');
    }

    let photoUrl: string | undefined;
    if (req.file) {
      const rel = `profiles/${uuidv4()}.${extForMime(req.file.mimetype)}`;
      await saveBuffer(rel, req.file.buffer);
      photoUrl = rel;
    }

    const { rows } = await query(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         upi_id    = COALESCE($3, upi_id),
         photo_url = COALESCE($4, photo_url)
       WHERE id = $1
       RETURNING *`,
      [user.id, body.fullName ?? null, body.upiId ?? null, photoUrl ?? null],
    );
    ok(res, rowToUser(rows[0]));
  }),
);
