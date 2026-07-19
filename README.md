# PotholeCollect — Pothole Data Collection Platform

**Powered by Threemates Tech Ventures** · v1.0.0

A full-stack platform for collecting GPS-tagged pothole training data (photos and
videos) from field collectors, with admin review, earnings, and settlements.

## Monorepo layout

| Path | What it is |
|---|---|
| `apps/mobile` | Expo (React Native) app for Android & iOS — capture, annotate, upload |
| `apps/api` | Node.js + Express + PostgreSQL REST API (`/api/v1`) |
| `apps/admin` | React (Vite) web dashboard for admins |
| `packages/shared` | Shared TypeScript types, business rules, geo/estimation math |

## How it works

1. **Signup** — Google sign-in via Auth0, then profile details (full name, photo,
   Student/Professional, UPI ID). Camera + precise GPS permissions are requested.
   The account waits for **admin approval** before anything else unlocks.
2. **Package** — starter package: **10 pothole videos** (moving road) *or*
   **20 pothole photos** → **₹1000**. Duplicate or previously-submitted samples
   (by anyone) are rejected automatically.
3. **Capture** — pre-flight checks: connectivity, precise GPS (≤15 m accuracy),
   mock-location rejection, camera permission. Photos are annotated in-app
   (polygon + label + size/material estimates). Videos record a timestamped GPS
   track so every annotated pothole's coordinates can be interpolated from the
   video timeline — media files are **never watermarked and metadata is never
   altered**; coordinates live in sidecar JSON.
4. **Rules** — videos: ≥ 40 s, ≥ 2 marked potholes, vehicle speed held near
   60 km/h (server validates a 60–65 km/h window; the in-app speedometer is
   capped at 60). Focus on the road — trees, buildings, vehicles, people,
   animals, signboards get samples rejected.
5. **Review** — admins accept/reject in the web dashboard (photo overlays, video
   player synced to the GPS path). A rejected sample can never be re-uploaded —
   the collector must capture a new one.
6. **Earnings** — each accepted sample credits payout/quota to a running ledger.
   Admins settle manually (UPI), uploading payment proof; settlement marks all
   earnings up to that point as settled.
7. **Export** — accepted samples download as bifurcated ZIPs
   (`photos/<id>/`, `videos/<id>/` with media + annotations + GPS track +
   training-ready metadata), or push straight to Google Drive.
8. **Offline** — captures queue locally (SQLite + filesystem) and upload in
   1 MB resumable chunks whenever connectivity returns.
9. **Mail** — Resend powers notifications: signup received, account approved,
   sample accepted/rejected, settlement completed.

## Quick start

```bash
# 1. Database
docker compose up -d          # Postgres 16 on :5432

# 2. API
npm install
cp apps/api/.env.example apps/api/.env   # fill in Auth0 / Resend / Drive keys
npm run migrate
npm run api                   # http://localhost:4000

# 3. Admin dashboard
cp apps/admin/.env.example apps/admin/.env
npm run admin                 # http://localhost:5173

# 4. Mobile app
cd apps/mobile && npm install
npm run sync-shared           # refresh the shared-code copy
npx expo prebuild && npx expo run:android   # react-native-auth0 needs a dev build
```

Each app's README covers its own setup in detail, including the Auth0 tenant
configuration (Google social connection, native + SPA apps, API audience).

## Versioning

Platform version lives in `packages/shared/src/constants.ts` (`APP_VERSION`)
and is surfaced in the mobile splash/profile screens, the admin sidebar, and
`GET /api/v1/version`.
