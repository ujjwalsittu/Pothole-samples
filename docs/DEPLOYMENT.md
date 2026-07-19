# Deployment Guide — Railway + Mobile Builds

End-to-end: API + database + admin dashboard on **Railway** with custom
domains, then the mobile app configured, splash-checked, and built for dev
and the stores.

---

## 0. Prerequisites

- A [Railway](https://railway.app) account (Hobby plan works to start)
- An [Auth0](https://auth0.com) tenant (free tier fine)
- A [Resend](https://resend.com) account + your sending domain verified
- An S3-compatible bucket (AWS S3 / Cloudflare R2) — **required on Railway**,
  see §1.4
- Node 18+, `npm i -g @railway/cli eas-cli` locally
- A domain you control (example below: `potholes.example.com`)

---

## 1. API on Railway

### 1.1 Project + database

1. Railway → **New Project → Deploy PostgreSQL**. That's the database.
2. **New Service → GitHub Repo** → pick this repository.
3. Service **Settings**:
   - **Root Directory**: leave `/` (the workspace install needs the repo
     root — the shared package lives in `packages/`).
   - **Build Command**: `npm install && npm run build --workspace apps/api`
   - **Start Command**:
     `npm run migrate --workspace apps/api && npm run start --workspace apps/api`
     (migrations run on every deploy; they're idempotent.)
   - **Watch Paths** (optional): `apps/api/**`, `packages/shared/**`

### 1.2 Environment variables (API service → Variables)

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference) |
| `PORT` | Railway injects this — don't set it |
| `AUTH0_DOMAIN` | `your-tenant.auth0.com` |
| `AUTH0_AUDIENCE` | `https://api.potholes.example.com` (your API identifier in Auth0) |
| `RESEND_API_KEY` | from Resend |
| `MAIL_FROM` | `PotholeCollect <no-reply@potholes.example.com>` |
| `ADMIN_EMAIL` | `ujjwal@threemates.tech` |
| `CORS_ORIGINS` | `https://admin.potholes.example.com` |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` / `S3_REGION` | your bucket |
| `S3_ENDPOINT` | only for R2/Spaces/MinIO |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | bucket credentials |
| `OSRM_DATA_DIR` | `/data/osrm` (only if using the OSRM manager — see §1.5) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `DRIVE_FOLDER_ID` | optional Drive export |

Never set `DEV_AUTH_BYPASS` in production.

### 1.3 Domain mapping

1. API service → **Settings → Networking → Generate Domain** — you get
   `something.up.railway.app`; confirm `/api/v1/health` responds.
2. **+ Custom Domain** → `api.potholes.example.com`. Railway shows a CNAME
   target — add that CNAME record at your DNS provider. TLS is automatic.
3. Use `https://api.potholes.example.com` everywhere below (admin env,
   mobile `apiUrl`, Auth0 audience should match what you configured).

### 1.4 Storage: why S3 is required here

Railway containers have **ephemeral filesystems** — redeploys wipe local
disk. Media must live in S3/R2 (`STORAGE_DRIVER=s3`). If you prefer disk,
attach a Railway **Volume** to the service, mount it (e.g. `/data`), and set
`STORAGE_DIR=/data/uploads` — but S3 is the recommended production setup.

ffmpeg needs nothing: the bundled `ffmpeg-static` binary installs during
`npm install` on Railway's builder.

### 1.5 OSRM on Railway (optional)

The in-panel OSRM manager needs OSRM binaries or Docker in the same
container — neither is present in Railway's default image. Easiest: run
OSRM as a **separate Railway service** from the `osrm/osrm-backend` Docker
image with a Volume for the preprocessed data (prep the data locally per
`docs/SERVICES.md` §3 and upload to the volume), then set `OSRM_URL` on the
API service to that service's internal URL. Or run OSRM on any VPS and
point `OSRM_URL` at it. The Services panel then shows it as
externally-managed.

---

## 2. Admin dashboard on Railway

Vite env vars are **build-time**, so they go on this service and a rebuild
is needed when they change.

1. **New Service → same GitHub repo**. Settings:
   - **Build Command**:
     `npm install && npm run build --workspace apps/admin`
   - **Start Command**:
     `npx serve apps/admin/dist -s -l $PORT`
2. Variables:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://api.potholes.example.com` |
| `VITE_AUTH0_DOMAIN` | `your-tenant.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | the Auth0 **SPA** app's client id |
| `VITE_AUTH0_AUDIENCE` | same audience as the API |

3. Networking → custom domain `admin.potholes.example.com` (CNAME as in
   §1.3). Add this URL to the API's `CORS_ORIGINS` and to the Auth0 SPA
   app's Allowed Callback/Logout/Web Origins.

---

## 3. Auth0 production checklist

1. **API** (Auth0 → Applications → APIs): identifier =
   `https://api.potholes.example.com` → this is `AUTH0_AUDIENCE`.
2. **SPA app** (admin): callbacks/logout/web origins =
   `https://admin.potholes.example.com`.
3. **Native app** (mobile): callbacks per react-native-auth0 docs:
   `potholecollect://your-tenant.auth0.com/android/com.threemates.potholecollect/callback`
   (+ the iOS equivalent with the bundle id).
4. **Google social connection** enabled for both apps.
5. First login bootstrap: the **first user ever** — or any login by
   `ujjwal@threemates.tech` — is automatically made primary admin (owner)
   and pre-approved. Log in with that account first, then approve/designate
   everyone else from the dashboard.

---

## 4. Mobile app — configure, verify, build

### 4.1 Configuration

Edit `apps/mobile/app.json`:

```jsonc
"extra": {
  "apiUrl": "https://api.potholes.example.com",
  "auth0Domain": "your-tenant.auth0.com",
  "auth0ClientId": "<native app client id>",
  "auth0Audience": "https://api.potholes.example.com",
  "eas": { "projectId": "<from `eas init`>" }   // required for push
}
```

Also replace the `YOUR_TENANT.auth0.com` placeholder inside the
`react-native-auth0` plugin entry, then:

```bash
cd apps/mobile
npm install
npm run sync-shared
npx expo prebuild --clean     # regenerates android/ + ios/ with the plugins
```

`prebuild --clean` is required after any change to plugins, app id, or the
Auth0 domain.

### 4.2 Splash screen & branding check

Asset expectations (already in `assets/`): `icon.png` 1024×1024,
`splash.png` 1284×2778, `adaptive-icon.png`; splash background `#0B1220`.

Verify on device/emulator:

1. `npx expo run:android` (or `run:ios`)
2. Cold-start the app — you should see: the static splash (dark navy with
   the logo) → the animated splash route (logo spring-in, "Powered by
   Threemates Tech Ventures", `v1.0.0`) → login or dashboard.
3. If the static splash shows a white flash or a stretched logo: confirm
   `app.json → splash.resizeMode` is `contain` and the background color
   matches, then `npx expo prebuild --clean` and rebuild — splash config is
   baked at build time, not OTA-updatable.
4. Icon check: home screen + app switcher on Android (adaptive icon mask)
   and iOS.

### 4.3 Development builds

Expo Go is **not** supported (react-native-auth0 is a native module). Use
dev builds:

```bash
# local (device/emulator attached, SDKs installed):
npx expo run:android          # or run:ios on macOS

# or cloud dev builds:
eas build --profile development --platform android
# install the artifact, then:
npx expo start --dev-client
```

Create `apps/mobile/eas.json` if absent:

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview":     { "distribution": "internal" },
    "production":  { "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

### 4.4 Production builds & store submission

```bash
eas login && eas init                  # once; put projectId into app.json extra
eas build --profile production --platform android   # AAB for Play Store
eas build --profile production --platform ios       # needs Apple Dev account
eas submit --platform android          # or upload the AAB manually
eas submit --platform ios
```

- `preview` profile builds an installable APK/IPA for internal testing
  without the stores.
- Bump `version` in `app.json` per release; `autoIncrement` handles build
  numbers.
- Push notifications require the EAS `projectId` and, for Android, FCM
  credentials (`eas credentials`) — Expo's docs walk through it once.

---

## 5. Post-deploy checklist

- [ ] `https://api.potholes.example.com/api/v1/health` → `{ ok: true }` and
      `/api/v1/version` shows the right version
- [ ] Log in to the admin as `ujjwal@threemates.tech` (becomes primary
      admin automatically)
- [ ] Resend domain verified; signup email arrives
- [ ] Upload a sample from the app end-to-end: capture → annotate → upload
      → review → thumbnail visible (proves S3 + ffmpeg)
- [ ] Designate a test collector, accept enough samples to complete a
      track, request + approve a withdrawal
- [ ] (Optional) Upload the SSDLite avoid-object model in Services →
      Models (`scripts/prepare_ssdlite`) — apps pick it up OTA
- [ ] (Optional) OSRM service up and `OSRM_URL` set; run map-matching once
- [ ] Database backups: Railway Postgres → enable scheduled backups
