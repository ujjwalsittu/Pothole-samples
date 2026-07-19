# PotholeCollect — mobile app

Expo (SDK 51) + expo-router app for collecting pothole photo/video samples with
precise GPS, polygon annotations, size estimates and an offline-first chunked
upload pipeline. Dark navy + amber branding, powered by
**Threemates Tech Ventures**.

> **Positioning:** the app is marketed as **civic pothole submission** — users
> report potholes to make roads safer. There is **zero money/rewards copy**
> anywhere pre-login or for regular users. Earnings, plans and withdrawals
> exist only for **admin-assigned collectors** (`profile.isCollector`), and
> every money surface in the app is gated on that flag.

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

## Push notifications

`expo-notifications` is configured (dependency + config plugin). Registration
happens **after admin approval** — the first time the tab bar mounts, never
during onboarding — and POSTs the Expo push token to `/me/push-token`.
Permission denial is fully graceful (the app just never registers). Foreground
notifications are suppressed at the OS level and surfaced through the in-app
snackbar instead. For EAS builds set `extra.eas.projectId` (added automatically
by `eas init`) so `getExpoPushTokenAsync` can mint tokens.

## On-device road guidance (src/detection/)

A pluggable `FrameAdvisor` interface guides collectors while capturing
(`analyze(frame) → { roadLikely, potholeLikely, hint }`). Two implementations:

- **HeuristicAdvisor (default, zero extra deps):** expo-camera cannot stream
  frames without additional native libraries, so the default advisor works from
  what the standard build has: device pitch via `expo-sensors` DeviceMotion
  (pointing at the sky or the floor → "Point the camera at the road ahead") and
  GPS speed (video mode, not moving → "Start driving to record"). Hints appear
  as an animated, non-blocking amber pill on both capture screens.
- **TFLite advisors (optional):** activate automatically when BOTH are present:
  1. `react-native-fast-tflite` installed (declared as an *optional* peer
     dependency — `npm install react-native-fast-tflite` + `npx expo prebuild`);
  2. a model binary at `documentDirectory/models/road-detector.tflite`
     (OTA-delivered or pushed with `adb push` during development). The repo
     intentionally does **not** ship any binary.

  The installed model's `kind` (recorded in `models/model-meta.json` from
  `/models/latest`) selects the adapter:
  - **`road-binary`** → `TfliteAdvisor`: input `[1,224,224,3]u8` → `[1,2]` =
    `[roadProb, potholeProb]`.
  - **`ssd-coco`** → `SsdCocoAdvisor` (`src/detection/ssd-coco.ts`): a standard
    TFLite SSD PostProcess detector (e.g. SSDLite-MobileNetV2), input
    `[1,300,300,3]u8`, outputs boxes/classes/scores/count with the embedded
    90-slot COCO label map (`src/detection/coco-labels.ts`). Detections with
    score > 0.5 in the avoid set (people, vehicles, animals, plants, signs)
    covering > 20% of the frame trigger "Move away from <label> — keep the
    road in frame". **COCO has no pothole class, so `potholeLikely` is always
    false for this kind** — it only flags what should not dominate the frame.

  If the module or model is missing the factory falls back to the heuristic
  silently. Wiring a camera frame processor is the single drop-in point left
  (`AdvisorFrame.frameData`).

### OTA model delivery

The detection model ships to installed apps **without a rebuild**:

1. An admin uploads/publishes a `.tflite` in the web dashboard; the API then
   serves `GET /models/latest` (`{version, sha256, sizeBytes, notes, url}`,
   `404 NO_MODEL` when none is published) and streams the binary from
   `GET /models/latest/file` (Bearer auth).
2. On each launch (shortly after the tab bar mounts, same spot as push
   registration) and on every manual dashboard pull-to-refresh, the app runs
   `checkForModelUpdate()` (`src/detection/model-updater.ts`): it compares the
   server version against `models/model-meta.json`, downloads a newer model to
   `road-detector.tflite.tmp` with the auth header, verifies size + sha256
   (same base64/composite scheme as uploads), atomically renames it over
   `models/road-detector.tflite` and records the meta. A snackbar confirms
   "Road-detection model v<version> installed" and the advisor singleton is
   invalidated so the next capture screen loads the new model.
3. All failure modes (no published model, offline, checksum mismatch) are
   silent no-ops — the previous model (or the heuristic) keeps working.
4. **The TFLite runtime still requires the optional native module**
   (`react-native-fast-tflite` + dev build). Without it the downloaded model
   sits dormant on disk and the sensor-based heuristic advisor continues; the
   Profile screen's Help card shows which state you are in
   ("Detection model: v<version> (active)" vs "not installed — using sensor
   guidance").

## Feature walkthrough

- **Splash → routing** (`app/index.tsx`): animated logo + "Powered by
  Threemates Tech Ventures" + version, then routes by auth/profile state:
  login → signup details → pending approval → tabs. First
  approved login shows the **animated walkthrough** (`app/walkthrough.tsx`,
  6 swipeable slides with parallax + animated dots; AsyncStorage flag
  `walkthrough_seen_v1`; replayable from Profile). One-time **coach marks**
  additionally point out the dashboard capture buttons, the photo annotator
  flow and the video HUD.
- **Signup** (`(auth)/signup-details`): name **prefilled from the Auth0
  profile**, photo, occupation picker Student/Professional/Self (Student →
  required College/University; Professional → optional Company), mobile number
  (10-15 digits) + "This number is on WhatsApp" checkbox, camera/mic/location
  permission rationale. A best-effort GPS fix (`signupLocation`) and a device
  fingerprint (expo-device + expo-constants + a per-install UUID in
  SecureStore) are sent for admin fraud review. **No UPI at signup** — UPI is
  captured at the first withdrawal. No package/offer screen follows; signup
  goes straight to pending-approval.
- **Collector plan** (Profile + dashboard, collectors only): the live package
  from `/me` (`profile.package`) with **independent per-track payouts** —
  completing `videoQuota` videos activates `videoPayoutInr`, completing
  `photoQuota` photos activates `photoPayoutInr`; partial tracks activate
  nothing. "Next up: …" teaser when `nextPackageCode` is set. The first time
  `isCollector` turns true the dashboard shows a one-time congratulation
  banner.
- **Dashboard**: stagger-in stat cards with count-up numbers (accepted includes
  partially accepted), streak flame chip (≥2 days), **"Boost zones near you"**
  (GET `/campaigns/nearby` with distance + compass direction + active window;
  hidden when empty), big Capture Photo / Record Video buttons, offline-upload
  banner. Collectors additionally see plan-progress bars (with per-track ₹)
  and **Active** ("withdrawable now") vs **Upcoming** ("unlocks when a track
  completes") balance cards; everyone else sees a money-free "Community
  impact" card instead.
- **Capture preflight** (`capture/preflight?mode=photo|video`): sequential
  checks — internet (offline allowed, sample is queued), location services +
  permission + first fix ≤ 15 m accuracy, mock-location rejection (hard fail),
  camera + microphone permissions. If you are standing inside an active
  campaign zone it shows "You are in <name> — <boost>× payout active".
- **Photo capture**: framing-guide overlay plus the live guidance pill; GPS fix
  taken at shutter time. Coordinates are **never drawn on the image and EXIF is
  never altered** — location lives only in the metadata JSON.
- **Photo annotator**: draw a scale-reference line across the visible road
  width (defaults per road type, e.g. asphalt 3.5 m), then tap-to-draw polygons
  around each pothole (spring vertex drop-in, drag with crosshair feedback,
  undo, close, multiple potholes), choose label/severity/fill material and see
  live diameter/area/volume/kg estimates from `shared/estimation.ts`.
- **Video capture**: GPS track recorded every second (`GpsPoint` incl. true
  speed + mocked flag). HUD: elapsed timer (crossfades red → green at 40 s),
  "capture ≥2 potholes" hint, pulsing REC indicator and a smooth animated
  speedometer. **Speed rule note:** there is **no minimum speed** — the rule is
  simply "drive at up to 60 km/h". The speedometer is capped at 60 and the
  label reads "Max: 60 km/h"; the UI never shows a number above 60. The only
  warning is over-speed ("You're going too fast — stay at or under 60"), and
  the actual enforcement window is applied **server-side** from the true speeds
  stored in the GPS track. Stop is disabled until 40 s.
- **Video annotator**: scrub/seek, "Mark pothole here" pauses the frame and
  opens the same polygon annotator; each mark stores `videoTimeSec` and shows
  its coordinate interpolated from the GPS track (`coordinateAtVideoTime`).
  Saving requires ≥ 2 marked potholes.
- **Upload pipeline** (`src/upload/`): sqlite-backed queue
  (draft → init → chunked upload (1 MB chunks, per-chunk retry/backoff,
  resumable) → complete → annotations → done). Size limits enforced locally
  too: photos ≤ 25 MB, **videos ≤ 1 GB**. Typed server rejections
  (`DUPLICATE_*`, `SPEED_OUT_OF_RANGE`, …) mark the item **rejected** with a
  friendly message — rejected samples can never be re-uploaded; capture a new
  one. Retries trigger on app foreground, connectivity change and manual retry;
  queue events surface as snackbar toasts.
- **Samples**: list with authenticated **thumbnails** (GET `/media/:id/thumb`
  downloaded once with the Bearer token via expo-file-system into a local
  cache), state chips incl. **Partially accepted** (teal — "some annotations
  were adjusted by the reviewer — full credit granted") and rejection reasons
  with an explicit no-re-upload note.
- **Earnings** (collectors only — the tab is hidden otherwise): Earned/Settled
  summary, **Active vs Upcoming** balance cards, full ledger with settlement
  proof/UTR links, and **withdrawals**: "Request withdrawal" opens a sheet
  (amount defaults to the full active balance, UPI prefilled from the profile
  after the first request), `POST /withdrawals` with friendly handling of
  `EXCEEDS_ACTIVE_BALANCE` (explains that upcoming earnings unlock on track
  completion) and `NOT_A_COLLECTOR`; request history with
  requested/approved/rejected/paid chips. The screen states explicitly:
  "Earnings activate only when a full track completes — e.g. 19 of 20 photos
  pays nothing until the 20th is accepted."
- **Ranks**: current + best streak card (flame, count-up), month/all-time
  leaderboard toggle, top-50 list with gold/silver/bronze medals, your row
  highlighted and pinned to the bottom when outside the top 50. ₹ amounts
  render only when positive (the API zeroes them for non-collectors).
- **Profile**: editable name/UPI/photo, live package details, replay
  walkthrough, logout. **Admin tab** (admins only): approve/reject users,
  pending-review count (full review lives in the web dashboard).

## Notes / caveats

- `sha256` is computed with `expo-crypto` over the file's base64 (chunked read;
  large files use a composite of per-chunk digests) — the API verifies with the
  same scheme. Perceptual hash is sent as `null`; the server computes it.
- Placeholder PNG assets are generated by `npm run gen-assets`
  (`scripts/gen-assets.js`, no image libraries needed). Replace with real art
  before release. `assets/logo.svg` mirrors the inline `src/components/Logo.tsx`.
- Mock-location detection uses the OS `mocked` flag (Android); iOS has no such
  flag, so the server-side checks remain authoritative.
- The optional TFLite path resolves its native module through a dynamic
  (variable-specifier) `require` so Metro does not hard-fail when
  `react-native-fast-tflite` is not installed.
