# PotholeCollect API

Backend for the pothole data-collection platform (Express + PostgreSQL + TypeScript, run with `tsx` so the `@pothole/shared` TS source is imported directly).

## Setup

```bash
# 1. Postgres (from repo root)
docker compose up -d          # postgres:16, db "potholes" on :5432

# 2. Install (workspace-aware; run from repo root or apps/api)
npm install

# 3. Configure
cp apps/api/.env.example apps/api/.env   # then edit

# 4. Migrate
npm run migrate --workspace apps/api

# 5. Run
npm run dev --workspace apps/api         # tsx watch
npm run build --workspace apps/api       # typecheck only (tsc --noEmit)
```

## Environment

| Var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 4000) |
| `DATABASE_URL` | Postgres connection string |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | Auth0 JWT validation (RS256) |
| `DEV_AUTH_BYPASS` | `1` = local dev auth via `x-dev-sub` / `x-dev-email` headers (only when Auth0 is unset; loudly logged) |
| `RESEND_API_KEY`, `MAIL_FROM`, `ADMIN_EMAIL` | Transactional mail via Resend (no-op + log when key unset) |
| `STORAGE_DIR` | Media root (default `./uploads`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_FOLDER_ID` | Google Drive export (endpoint returns `501 NOT_CONFIGURED` when unset) |
| `CORS_ORIGINS` | Comma-separated allowed origins (empty = allow all) |

## Auth (Auth0)

1. Create an Auth0 **API** (identifier = `AUTH0_AUDIENCE`) and enable RS256.
2. Create the mobile/SPA applications; enable the **Google social connection** (google-oauth2) so collectors can sign in with Google.
3. Add a post-login Action that copies `user.email` into the access token as a custom claim (the API reads `email` or `https://pothole/email`); ID-token email alone is not visible to the API.
4. Roles live in the **database** (`users.role`), not in Auth0: every account starts as `collector`; promote via `PATCH /api/v1/admin/users/:id` (or SQL for the first admin). If you prefer Auth0 `app_metadata` roles, mirror them into the DB at signup — the API treats the DB as authoritative. `owner` counts as `admin` everywhere.
5. Local dev without Auth0: leave `AUTH0_DOMAIN` empty, set `DEV_AUTH_BYPASS=1`, and send `x-dev-sub` / `x-dev-email` headers.

Bootstrap the first admin:

```sql
UPDATE users SET role='admin', account_state='approved' WHERE email='you@example.com';
```

## Endpoints (all under `/api/v1`, envelope `{ok:true,data}` / `{ok:false,error:{code,message}}`)

Public: `GET /health`, `GET /version`

Authenticated:

- `POST /auth/signup-complete` — multipart `photo?` + `fullName`, `collectorStatus` (student|professional), `upiId`. Creates `pending_approval` user from the token identity; idempotent; mails user + `ADMIN_EMAIL`.
- `GET /me` (404 `USER_NOT_REGISTERED` before signup), `PATCH /me` (fullName/upiId/photo)
- `GET /dashboard/stats`

Samples (approved collectors; resumable, offline-friendly):

- `POST /samples/init` — metadata pre-checks **before any bytes**: `DUPLICATE_EXACT`, `DUPLICATE_NEARBY`, `MOCK_LOCATION`, `GPS_INACCURATE`, `VIDEO_TOO_SHORT`, `SPEED_OUT_OF_RANGE`, `FILE_TOO_LARGE`. Returns `{sampleId, chunkBytes, receivedBytes}`. Re-init with the same sha256 while still `uploading` resumes (returns `receivedBytes`).
- `PUT /samples/:id/chunks/:index` — raw chunk (≤ 2 MB) written at `index × chunkBytes`; idempotent per chunk.
- `POST /samples/:id/complete` — verifies size + sha256, recomputes photo phash server-side (sharp aHash, authoritative; falls back to the client hash if sharp is unavailable), then `uploaded` → `pending_review` once enough annotations exist. Integrity failure ⇒ `auto_rejected`.
- `POST /samples/:id/annotations` — replaces the annotation set. Video coordinates are always recomputed server-side via `coordinateAtVideoTime` from the GPS track; photos use the sample coordinate. `< 2` potholes on a video ⇒ warning `NEED_MORE_POTHOLES` and the sample stays `uploaded`.
- `GET /samples`, `GET /samples/:id` (own or admin; includes annotations + track)
- `GET /media/:sampleId` — streams media (owner/admin, Range supported)

Earnings: `GET /earnings/ledger`, `GET /earnings/summary`

Admin (`role` admin/owner):

- `GET /admin/users?state=…`, `POST /admin/users/:id/approve`, `POST /admin/users/:id/reject`, `PATCH /admin/users/:id` (role / collectorStatus)
- `GET /admin/samples?state=pending_review` (default), `GET /admin/samples/:id`
- `POST /admin/samples/:id/review` `{decision, reason?}` — accept credits `payout_inr / video_quota` (₹100) or `payout_inr / photo_quota` (₹50) transactionally with a running-balance ledger entry + mail; reject is **permanent** + mail. Second review ⇒ `409 ALREADY_REVIEWED`.
- `GET /admin/settlements`, `GET /admin/users/:id/balance`, `POST /admin/users/:id/settlements` — multipart `{amountInr, utrReference?, proof}`; amount capped at unsettled balance; creates settled settlement + negative ledger entry; marks earnings settled oldest-first; mails the user.
- `GET /admin/export/accepted.zip?mediaType=photo|video|all` — streaming zip: `photos/<id>/{media, annotations.json, meta.json}`, `videos/<id>/{media, annotations.json, track.json, meta.json}`. Media bytes are never modified.
- `POST /admin/export/drive` — same structure into a dated Google Drive subfolder; `501 NOT_CONFIGURED` without service-account env.

## Business rules

- **Speed (video):** real window is 60–65 km/h average/max from the GPS track, but users are only ever told **"60 km/h"** — error messages and the app speedometer never reveal the 65 upper bound.
- **Video:** ≥ 40 s duration and ≥ 2 annotated potholes; every annotation's coordinate is interpolated from the GPS track at its video timestamp.
- **GPS:** accuracy ≤ 15 m required; mock/simulated locations always rejected (flag or any mocked track fix).
- **Dedup:** exact sha256 match rejected globally; perceptual-hash (64-bit aHash) hamming ≤ 10 within 15 m rejected as nearby-duplicate. Photo phash is recomputed server-side on upload completion.
- **Package:** STARTER_1000 — 10 videos or 20 photos ⇒ ₹1000 (₹100/video, ₹50/photo, credited per accepted sample).
- **Rejection is permanent:** a rejected sample can never be re-uploaded (sha256 stays on file); collectors must capture a new sample.
- **Settlement:** manual UPI payout by admin with proof/UTR; on disbursement all earnings up to that amount (oldest first) are marked settled.
