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

Optional system dependency: **ffmpeg** (`apt install ffmpeg`) — used for video
poster thumbnails and per-annotation frame extraction. Everything degrades to
a logged no-op without it.

## Environment

| Var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 4000) |
| `DATABASE_URL` | Postgres connection string |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | Auth0 JWT validation (RS256) |
| `DEV_AUTH_BYPASS` | `1` = local dev auth via `x-dev-sub` / `x-dev-email` headers (only when Auth0 is unset; loudly logged) |
| `RESEND_API_KEY`, `MAIL_FROM`, `ADMIN_EMAIL` | Transactional mail via Resend (no-op + log when key unset) |
| `STORAGE_DIR` | Local media root / staging dir (default `./uploads`) |
| `STORAGE_DRIVER` | `local` (default) or `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | S3 driver config; `S3_ENDPOINT` enables MinIO-compatible path-style mode. Credentials via the standard AWS chain |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_FOLDER_ID` | Google Drive export (endpoint returns `501 NOT_CONFIGURED` when unset) |
| `OSRM_URL` | External OSRM base URL for map-matching (optional — the managed OSRM instance takes precedence when running) |
| `OSRM_DATA_DIR`, `OSRM_PORT` | Managed OSRM working dir (default `./osrm-data`) and port (default 5001) |
| `CORS_ORIGINS` | Comma-separated allowed origins (empty = allow all) |

### Storage drivers

Resumable chunk uploads always assemble on **local staging disk**. With
`STORAGE_DRIVER=s3`, once the checksum verifies on `/complete` the assembled
file is promoted to S3 via multipart upload (`@aws-sdk/lib-storage`) and the
staging copy is deleted; `samples.storage_driver` records where each sample's
media lives, and media streaming proxies S3 `GetObject` with full Range/206
pass-through. Profile photos, settlement proofs, thumbnails and extracted
frames are written straight through the driver.

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

Collector:

- `POST /auth/signup-complete` — multipart `photo?` + `fullName`, `collectorStatus`, `upiId`; idempotent; mails user + `ADMIN_EMAIL`.
- `GET /me` (includes full `package` PackageInfo; 404 `USER_NOT_REGISTERED` before signup), `PATCH /me`, `POST /me/push-token` (Expo token), `GET /me/streak`
- `GET /dashboard/stats` (accepted + partially accepted both fill quota; `partiallyAccepted` reported separately)
- `GET /leaderboard?period=month|all` — top collectors (accepted+partial count, earnings tie-break, streaks, `isMe`, own row appended when outside top N)
- `GET /campaigns/nearby?lat=&lng=` — active campaign zones containing the point or within 10 km

Samples (approved collectors; resumable, offline-friendly):

- `POST /samples/init` — pre-checks **before any bytes**: `DUPLICATE_EXACT`, `DUPLICATE_NEARBY`, `MOCK_LOCATION`, `GPS_INACCURATE`, `VIDEO_TOO_SHORT`, `SPEED_OUT_OF_RANGE`, `FILE_TOO_LARGE`. Captures inside an active campaign polygon record `campaign_id` + `boost_applied`. Re-init with the same sha256 while `uploading` resumes.
- `PUT /samples/:id/chunks/:index` — raw chunk (≤ 2 MB) at `index × chunkBytes`; idempotent.
- `POST /samples/:id/complete` — verifies size + content hash (the mobile scheme: sha256 over base64, per-4MB-chunk composite for large files — see `apps/mobile/src/upload/hash.ts`), recomputes photo phash server-side, generates thumbnail (video poster @1s via ffmpeg / 480px photo thumb via sharp), then promotes media to the storage driver. Integrity failure ⇒ `auto_rejected`.
- `POST /samples/:id/annotations` — replaces the set; video coordinates always recomputed from the GPS track. `< 2` potholes on video ⇒ warning `NEED_MORE_POTHOLES`.
- `GET /samples`, `GET /samples/:id`, `GET /media/:sampleId` (Range supported, local or S3), `GET /media/:sampleId/thumb`

Earnings: `GET /earnings/ledger`, `GET /earnings/summary`

Admin (`role` admin/owner; every mutation is recorded in the audit log):

- Users: `GET /admin/users?state=`, `POST /admin/users/:id/approve|reject`, `PATCH /admin/users/:id` (role / collectorStatus / packageCode)
- Samples: `GET /admin/samples?state=`, `GET /admin/samples/:id`, `GET /media/:sampleId/frames/:annotationId`
- Annotations (photo + video, states uploaded/pending_review/accepted/partially_accepted):
  `POST /admin/samples/:id/annotations` (admin-created ⇒ status `accepted`), `PATCH /admin/annotations/:id` (videoTimeSec change recomputes coords), `DELETE /admin/annotations/:id`. `pothole_count` = non-rejected annotations.
- Review: `POST /admin/samples/:id/review` `{decision: accepted|partially_accepted|rejected, reason?}`
  - `accepted`: all pending annotations → accepted. `partially_accepted`: requires ≥1 accepted and ≥1 not-accepted annotation (`PARTIAL_REQUIRES_MIX` otherwise); remaining pending → rejected.
  - **Payout policy: accepted and partially_accepted earn the SAME full per-sample credit** (`payout_inr / quota`, ₹100 video / ₹50 photo on the starter package), multiplied by the sample's campaign `boost_applied`. This is an intentional, documented policy — prorate in the review handler if it ever changes.
  - Accepting a video also extracts a frame per accepted annotation (ffmpeg).
  - Completing either package quota (accepted+partial) auto-enrolls the collector into `next_package_code` (if set) and notifies "package complete, ₹X earned".
  - Re-review ⇒ `409 ALREADY_REVIEWED`. Rejection is **permanent**.
- Campaigns: `GET|POST /admin/campaigns`, `PATCH|DELETE /admin/campaigns/:id` (polygon ≥ 3 vertices, boost, date window)
- Packages: `GET|POST /admin/packages`, `PATCH /admin/packages/:code` (code immutable; edits affect future credits only; `next_package_code` chains packages)
- Settlements: `GET /admin/settlements`, `GET /admin/users/:id/balance`, `POST /admin/users/:id/settlements` (multipart, capped at unsettled balance).
  **Two-admin control:** amounts ≥ ₹5000 (`SETTLEMENT_CONFIRM_THRESHOLD_INR`) are created `awaiting_confirmation` and do NOT touch the ledger until `POST /admin/settlements/:id/confirm` by a **different** admin (`403 SAME_ADMIN` otherwise); `POST /admin/settlements/:id/cancel` aborts. Smaller amounts settle immediately. On settle: negative ledger entry + earnings marked settled oldest-first + mail/push with UTR.
- Audit: `GET /admin/audit?limit=&before=&action=` — every admin mutation with actor name.
- Post-processing: `POST /admin/postprocess/map-match {sampleIds?}` — snaps video tracks to the road network via OSRM (managed instance first, `OSRM_URL` fallback), downsampled ≤ 100 points; annotation coords recomputed on the matched geometry into `corrected_lat/lng` (`correction_source='osrm'`); originals untouched.
- OSRM manager (run OSRM entirely from the hosted platform):
  `GET /admin/osrm/status` (runner: `binaries` on PATH → `docker` → `unavailable`; download/preprocess/serve progress), `POST /admin/osrm/download {url}` (https-only .osm.pbf — use a regional Geofabrik extract; 409 while busy), `POST /admin/osrm/preprocess` (extract → partition → customize, MLD; async 202, poll status; `501 OSRM_RUNNER_UNAVAILABLE` with guidance when neither binaries nor docker exist), `POST /admin/osrm/serve` / `POST /admin/osrm/stop` (osrm-routed on `OSRM_PORT`, managed URL `http://127.0.0.1:5001`). State is in-memory — after an API restart status simply reports not-running (files on disk are still detected).
- Model OTA: `POST /admin/models` (multipart `.tflite` + notes; server-side sha256; stored via the driver at `models/<version>.tflite`; new release auto-activates, single active), `GET /admin/models`, `POST /admin/models/:id/activate`. Collector side: `GET /models/latest` → `{version, sha256, sizeBytes, notes, url}` (404 `NO_MODEL`), `GET /models/latest/file` streams the model.
- Road quality: `GET /admin/road-quality` — geohash-7 (~150 m) cells from accepted/partial annotations (corrected coords preferred). `severityIndex = min(100, annotations×12 + clusters×10)`.

Exports:

- `GET /admin/export/accepted.zip?mediaType=` — legacy raw layout, `accepted` only (back-compat).
- `GET /admin/export/training.zip?formats=coco,yolo,voc` — **training bundle**: accepted + partially_accepted, ONLY approved annotations, **zero GPS data**. Split-versioned `train/ val/ test/` (deterministic hash of collector + geohash cell — never random, no leakage across splits) with `images/`, `frames/` (extracted video frames), `videos/` + per-split labels in the requested formats (default all three: COCO json, YOLO txt, Pascal VOC xml with polygon extension) + `classes.txt`, plus top-level `manifest.json` (records the formats), bundle README and `tools/convert_to_tfrecord.py` (self-contained TFRecord converter for TensorFlow; PyTorch users consume the COCO json directly via `torchvision.datasets.CocoDetection` — no conversion needed). Every export records a `dataset_exports` row with the streamed zip's sha256.
- `GET /admin/export/raw.zip` — raw testing bundle: same sample set, unmodified media + full GPS (meta/track) + all annotations with statuses and corrected coords. Raw media/GPS is never deleted from storage.
- `GET /admin/datasets`, `GET /admin/datasets/:id/manifest.json` — dataset version registry.
- `POST /admin/export/drive {bundle: training|raw}` — same builders into a dated Drive folder.

## Business rules

- **Speed (video):** there is **no minimum speed**; only exceeding the real cap (65 km/h max on the track) rejects — but users are only ever told **"60 km/h"** (error copy: "Speed must stay at or below 60 km/h"); the 65 buffer is never revealed.
- **Video:** ≥ 40 s duration and ≥ 2 annotated potholes; annotation coordinates always interpolated from the GPS track.
- **GPS:** accuracy ≤ 15 m; mock locations always rejected.
- **Dedup:** exact content-hash match rejected globally; perceptual hash hamming ≤ 10 within 15 m rejected as nearby-duplicate.
- **Rejection is permanent:** a rejected sample can never be re-uploaded; a new sample is required.
- **Campaign boost:** samples captured inside an active campaign zone earn `base × boost` (default ×1.5) — applied at review time, noted in the ledger and mails.
