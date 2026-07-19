import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../db/pool';
import { rowToUser } from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { mail } from '../services/mail';
import { extForMime, saveBuffer } from '../services/storage';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const signupSchema = z.object({
  fullName: z.string().trim().min(1, 'fullName is required'),
  collectorStatus: z.enum(['student', 'professional']),
  upiId: z.string().trim().min(3, 'upiId is required'),
});

export const usersRouter = Router();

/**
 * POST /auth/signup-complete — multipart: fields fullName/collectorStatus/upiId
 * + optional `photo` file. Creates the pending_approval user from the token
 * identity. Idempotent: returns the existing user if already registered.
 */
usersRouter.post(
  '/auth/signup-complete',
  upload.single('photo'),
  asyncH(async (req, res) => {
    const authInfo = req.authInfo;
    if (!authInfo) throw new ApiError(401, 'UNAUTHORIZED', 'Not authenticated');

    if (req.user) return ok(res, req.user); // idempotent

    const body = signupSchema.parse(req.body);
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

    const { rows } = await query(
      `INSERT INTO users (auth0_sub, email, full_name, photo_url, collector_status, upi_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (auth0_sub) DO UPDATE SET auth0_sub = EXCLUDED.auth0_sub
       RETURNING *`,
      [authInfo.sub, email, body.fullName, photoUrl, body.collectorStatus, body.upiId],
    );
    const user = rowToUser(rows[0]);

    void mail.signupReceived(user.email, user.fullName);
    void mail.newSignupAdminAlert(user.fullName, user.email, user.collectorStatus);

    ok(res, user, 201);
  }),
);

/** GET /me — 404 USER_NOT_REGISTERED when no row exists yet. */
usersRouter.get('/me', requireUser, (req, res) => {
  ok(res, req.user);
});

const patchMeSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  upiId: z.string().trim().min(3).optional(),
});

/** PATCH /me — fullName / upiId fields + optional `photo` file (multipart). */
usersRouter.patch(
  '/me',
  requireUser,
  upload.single('photo'),
  asyncH(async (req, res) => {
    const user = req.user!;
    const body = patchMeSchema.parse(req.body ?? {});

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
