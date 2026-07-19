# PotholeCollect — mobile app

Expo (SDK 51) + expo-router app for collecting pothole photo/video samples with
precise GPS, polygon annotations, size/material estimates and an offline-first
chunked upload pipeline. Dark navy + amber branding, powered by
**Threemates Tech Ventures**.

## Setup

```bash
cd apps/mobile
npm install
npm run sync-shared   # copies packages/shared/src/*.ts into src/shared/
npx expo prebuild     # required: react-native-auth0 is a native module (no Expo Go)
npx expo run:android  # or: npx expo run:ios
```

For store builds use EAS:

```bash
npx eas build --platform android
npx eas build --platform ios
```

> The app cannot run in Expo Go because `react-native-auth0` ships native code —
> always use a development build (`expo prebuild` + `expo run:*`) or EAS.

### Shared business rules

`src/shared/` is a **checked-in copy** of `packages/shared/src` (Metro does not
reliably follow workspace symlinks). After changing the shared package run:

```bash
npm run sync-shared
```

## Auth0 setup

1. Create a **Native** application in your Auth0 tenant.
2. Enable the **google-oauth2** connection on it (Authentication → Social →
   Google) — the "Continue with Google" button calls
   `authorize({ connection: 'google-oauth2' })`. The plain "Log in" button opens
   Auth0 Universal Login (email/password etc.); **admins log in here too** — the
   app decides what to show from the `/me` role.
3. Allowed callback / logout URLs (Android):
   `com.threemates.potholecollect.potholecollect://YOUR_TENANT.auth0.com/android/com.threemates.potholecollect/callback`
   and the iOS equivalent per the react-native-auth0 docs. The custom scheme is
   `potholecollect` (configured via the `react-native-auth0` config plugin in
   `app.json`).
4. Create an API in Auth0 with identifier matching `auth0Audience` so access
   tokens are JWTs the backend can verify.

### Configuration (`app.json` → `expo.extra`)

| key            | meaning                                   |
| -------------- | ----------------------------------------- |
| `apiUrl`       | Base API URL incl. version, e.g. `https://api.example.com/v1` |
| `auth0Domain`  | `YOUR_TENANT.auth0.com` — replace the placeholder |
| `auth0ClientId`| Auth0 native app client id                |
| `auth0Audience`| Auth0 API identifier                      |

The **same placeholder domain** also appears in the `react-native-auth0` config
plugin entry in `app.json` (`plugins`) — replace it in both places, then re-run
`npx expo prebuild --clean`. Values are read at runtime via `expo-constants`
(`src/config.ts`).

## Feature walkthrough

- **Splash → routing** (`app/index.tsx`): animated logo + "Powered by
  Threemates Tech Ventures" + version, then routes by auth/profile state:
  login → signup details → package offer → pending approval → tabs.
- **Signup** (`(auth)/signup-details`): name, photo, Student/Professional
  status (only an admin can later change status to Owner), UPI ID with
  validation, and camera/mic/location permission rationale.
- **Package** (`(auth)/package`): the Starter package — 10 pothole videos on a
  moving road OR 20 pothole photos → ₹1000, plus all collection rules.
- **Dashboard**: stats, package progress bars, balance, big Capture Photo /
  Record Video buttons, offline-upload banner.
- **Capture preflight** (`capture/preflight?mode=photo|video`): sequential
  checks — internet (offline allowed, sample is queued), location services +
  permission + first fix ≤ 15 m accuracy, mock-location rejection (hard fail),
  camera + microphone permissions.
- **Photo capture**: framing-guide overlay ("road only — avoid trees,
  buildings, vehicles, people, animals, signboards"); GPS fix taken at shutter
  time. Coordinates are **never drawn on the image and EXIF is never altered** —
  location lives only in the metadata JSON.
- **Photo annotator**: draw a scale-reference line across the visible road
  width (defaults per road type, e.g. asphalt 3.5 m), then tap-to-draw polygons
  around each pothole (drag vertices to adjust, undo, close, multiple potholes),
  choose label/severity/fill material and see live diameter/area/volume/kg
  estimates from `shared/estimation.ts`.
- **Video capture**: GPS track recorded every second (`GpsPoint` incl. true
  speed + mocked flag). HUD: elapsed timer (red until 40 s), "capture ≥2
  potholes" hint, and a speedometer. **Speed rule note:** the speedometer is
  capped at 60 km/h and all copy says "Target: 60 km/h" / "keep it at 60" — the
  UI never shows a number above 60. The actual accept/reject window is enforced
  server-side from the true speeds stored in the GPS track. Stop is disabled
  until 40 s.
- **Video annotator**: scrub/seek, "Mark pothole here" pauses the frame and
  opens the same polygon annotator; each mark stores `videoTimeSec` and shows
  its coordinate interpolated from the GPS track (`coordinateAtVideoTime`).
  Saving requires ≥ 2 marked potholes.
- **Upload pipeline** (`src/upload/`): sqlite-backed queue
  (draft → init → chunked upload (1 MB chunks, per-chunk retry/backoff,
  resumable) → complete → annotations → done). Typed server rejections
  (`DUPLICATE_*`, `SPEED_OUT_OF_RANGE`, …) mark the item **rejected** with a
  friendly message — rejected samples can never be re-uploaded; capture a new
  one. Retries trigger on app foreground, connectivity change and manual retry.
- **Samples / Earnings / Profile / Admin tabs**: state chips incl. rejection
  reasons, full earnings ledger with settlement proof/UTR, editable profile
  (name/UPI/photo), and an admin-only tab for approving users (full sample
  review lives in the web dashboard).

## Notes / caveats

- `sha256` is computed with `expo-crypto` over the file's base64 (chunked read;
  large files use a composite of per-chunk digests) — the API verifies with the
  same scheme. Perceptual hash is sent as `null`; the server computes it.
- Placeholder PNG assets are generated by `npm run gen-assets`
  (`scripts/gen-assets.js`, no image libraries needed). Replace with real art
  before release. `assets/logo.svg` mirrors the inline `src/components/Logo.tsx`.
- Mock-location detection uses the OS `mocked` flag (Android); iOS has no such
  flag, so the server-side checks remain authoritative.
