# PotholeCollect — Complete How-To Guide

**Powered by Threemates Tech Ventures** · v1.0.0

This guide covers everything: how collectors capture samples, how the GPS ↔
video synchronization works, how annotation produces training-ready data, and
how admins review, settle, and export.

---

## 1. How GPS is matched to the video timeline (the core mechanism)

The single most important design rule of this platform: **a pothole's
coordinates are never guessed — they are always derivable from recorded
data.** Here is the full pipeline:

### 1.1 What gets recorded

When you press record, two clocks-aligned streams start simultaneously:

1. **The video file** — ordinary camera footage. We never modify it: no
   watermark, no coordinate overlay, no EXIF/metadata changes.
2. **The GPS track** — a sidecar array sampled every second
   (`SPEED.GPS_SAMPLE_INTERVAL_MS = 1000 ms`). Each fix is stored as:

```json
{ "t": 1721380000000,   // wall-clock ms — same clock as recordingStartMs
  "lat": 12.9716, "lng": 77.5946,
  "acc": 4.2,            // horizontal accuracy, meters
  "speedMps": 16.4,      // provider-reported speed (real, uncapped)
  "alt": 890.1,
  "mocked": false }      // OS mock-location flag — any true fix rejects the sample
```

The moment recording starts we also store `recordingStartMs` — the wall-clock
timestamp of video time **0:00**. That one number is the bridge between the
two streams:

```
wall-clock time of any video moment = recordingStartMs + (video position in seconds × 1000)
```

### 1.2 How an annotation becomes a coordinate

When the collector (or an admin) marks a pothole on the video, we store the
**video timeline position** (`videoTimeSec`), the polygon, and the label —
*not* a hand-picked coordinate. The coordinate is then **interpolated from
the track**:

1. Compute the target wall-clock time: `T = recordingStartMs + videoTimeSec × 1000`.
2. Find the two GPS fixes that bracket `T` (the track is sorted by `t`).
3. Linearly interpolate latitude/longitude between them proportionally to
   where `T` falls in that 1-second gap. At 60 km/h a vehicle moves ~16.7 m
   per second, so interpolation inside a 1 s gap keeps error well under GPS
   noise levels.
4. Clamp to the track's ends if the annotation is before the first or after
   the last fix.

This is implemented once, in `packages/shared/src/geo.ts →
coordinateAtVideoTime()`, and used by **both** the mobile app (to show the
collector live coordinates while annotating) and the API server (which
recomputes them **authoritatively** when annotations are saved — the client's
numbers are never trusted).

**Why this design is correction-friendly:** because annotations store
`videoTimeSec` rather than a frozen coordinate, coordinates can always be
*recomputed* later — e.g. after map-matching/snapping the raw track to the
road network, applying smoothing, or correcting clock drift. The raw track is
never deleted, so improved post-processing automatically yields improved
pothole coordinates for every historical sample.

### 1.3 Validation tied to the same track

The same GPS track drives automatic validation at upload:

- **Speed** — real average/max speeds are computed from provider speeds with
  a haversine-distance fallback. A sample is auto-rejected only if the max
  exceeds 65 km/h. (Collectors are only ever shown "max 60 km/h"; the 60–65
  band is a hidden tolerance. There is **no minimum speed**.)
- **Mock GPS** — any fix flagged `mocked: true` rejects the sample.
- **Duration** — videos under 40 seconds are rejected; videos need at least
  2 annotated potholes.
- **Photos** — a single GPS fix is captured at the exact shutter moment
  (accuracy must be ≤ 15 m) and stored in metadata, never on the image.

### 1.4 Duplicate prevention

Before a single media byte is uploaded, the client sends a fingerprint:

- an exact content hash (sha256-based) — matches reject instantly, across
  **all users**, so a pre-submitted sample can never be resubmitted;
- a perceptual hash compared (Hamming distance ≤ 10) against every existing
  sample within 15 m — so re-shooting the same pothole from the same spot is
  also caught, even if the file bytes differ.

---

## 2. Collector guide (mobile app)

### 2.1 Getting started

1. **Install & launch** — you'll get a short animated walkthrough on first
   launch (replay it any time from *Profile → Replay walkthrough*).
2. **Sign up with Google** (Auth0). Fill in: full name, photo, whether you're
   a *Student* or *Professional* (an admin can later upgrade you to *Owner*),
   and your **UPI ID** — that's where disbursements go.
3. Grant **camera** and **precise location** permissions when prompted.
4. Review the **package**: complete **10 pothole videos** *or* **20 pothole
   photos** → **₹1000**. Duplicates and previously-submitted samples don't
   count.
5. Wait for **admin approval** — you'll get an email when approved.

### 2.2 Capturing a photo sample

1. Dashboard → **Capture Photo**. Pre-flight checks run automatically:
   connectivity (offline is allowed — see §2.4), precise GPS, no mock
   location, camera permission.
2. Frame **the road surface only**. Avoid: trees, plants, buildings,
   vehicles, people, animals, signboards, sky. The overlay guide helps.
3. After the shot, **annotate**: tap around each pothole to draw a polygon,
   pick a label (pothole, alligator crack, edge break, …) and a severity.
4. Draw the **road-width reference line** and confirm the road type/width —
   this calibrates the image scale so the app can estimate each pothole's
   **diameter, area, volume, and the kilograms of fill material** needed.
5. Save — the sample enters your upload queue.

### 2.3 Recording a video sample

1. Dashboard → **Record Video**. Same pre-flight checks.
2. Drive at **up to 60 km/h** (no minimum). The on-screen speedometer warns
   you if you're too fast.
3. Record for **at least 40 seconds** (the timer turns green at 40 s) and
   make sure at least **2 potholes** are visible during the drive.
4. After stopping, **annotate**: scrub to each pothole moment, tap *Mark
   pothole here*, draw the polygon on the paused frame, label it. The app
   shows the exact GPS coordinate computed for each mark (see §1.2).
5. Save — videos up to **1 GB** are supported.

### 2.4 Offline mode & uploads

No internet? Capture anyway. Samples are stored on-device (media + metadata
in a local queue) and upload automatically — in small resumable chunks that
survive flaky networks — whenever connectivity returns. Watch progress in the
queue screen; retry manually any time.

### 2.4b Guidance, boost zones, ranks

- **Capture guidance** — while capturing, an on-device advisor nudges you if
  the camera is pointed at the sky or the ground ("Point the camera at the
  road ahead") or if you haven't started moving in video mode. With a TFLite
  road-detection model installed (see `apps/mobile/README.md`) the advisor
  upgrades to real frame analysis; without it a sensor-based heuristic runs.
- **Boost zones** — admins can declare campaign zones ("we need this area
  covered"). The dashboard shows zones near you with their payout multiplier
  (e.g. 1.5×); samples captured inside an active zone earn the boosted rate
  automatically.
- **Ranks & streaks** — the Ranks tab shows the monthly/all-time leaderboard
  and your streak (consecutive days with an accepted sample).
- **Notifications** — approval, sample decisions, and settlements arrive as
  push notifications (plus email).

### 2.5 Statuses, earnings, and payouts

- **Pending review** → an admin is checking your sample.
- **Accepted** → credit added to your ledger (videos ₹100, photos ₹50 —
  payout ÷ quota).
- **Partially accepted** → the reviewer kept your sample but adjusted or
  removed some annotations. **You still receive full credit.**
- **Rejected** → the reason is shown. A rejected sample can **never be
  re-uploaded** — capture a new one.
- **Earnings tab** — complete ledger: every credit, every settlement (with
  UTR reference and payment proof), and your running balance. When an admin
  settles you, all earnings up to that settlement are marked settled.

---

## 3. Admin guide (web dashboard)

### 3.1 Approvals

*Approvals* lists pending signups with photo, status, and UPI ID. Approve or
reject (with a reason — the applicant is emailed either way). On approved
users you can change their status (Student/Professional/**Owner**) or grant
admin rights.

### 3.2 Reviewing samples

The *Review Queue* shows each pending sample with everything you need:

- **Photos** — the image with polygon overlays, labels, and the size/material
  estimates.
- **Videos** — the player alongside the GPS path; a dot moves along the path
  in sync with playback (same interpolation as §1.2). Clicking an annotation
  seeks the video and highlights its coordinate. Real speeds and the true
  60–65 km/h tolerance are visible here (collectors only ever see 60).
- **Checklist** — auto-evaluated rules (duration, pothole count, speed, GPS
  accuracy, mock detection) plus manual content checks (no
  trees/buildings/vehicles/people/animals/signboards dominating).

### 3.3 Editing annotations (admin)

You can fix collectors' work instead of rejecting outright:

- **Edit** any polygon (drag vertices, add/remove points), relabel, or move a
  video annotation to a different timestamp (its coordinate is recomputed
  from the track automatically).
- **Create** new annotations the collector missed — on photos or on any
  paused video frame.
- **Accept/Reject individual annotations** with per-annotation status chips.

Then decide:

- **Accept all** — every annotation approved, full credit.
- **Partially accept** — only your approved subset ships to training data;
  the collector still gets full credit.
- **Reject** — with a reason; the collector must capture a new sample.

### 3.3b Map, campaigns, and packages

- **Map page** — every sample plotted on an OpenStreetMap view (colored by
  state, thumbnail popups), with toggleable layers for campaign zones and the
  road-quality heatmap.
- **Campaigns** — draw a polygon on the map, set a payout boost and date
  window, and collectors in that area see it as a boost zone. Samples
  captured inside credit at the boosted rate.
- **Packages** — create/edit earnings packages (quotas, payout, active flag)
  and chain them: when a collector completes a package, the configured next
  package starts automatically. Individual users can be moved between
  packages.
- **Leaderboard** — the same ranks collectors see, with earnings and streaks.

### 3.4 Settlements

*Settlements* shows every collector's earned/settled/balance. Settle
manually: enter the amount (defaults to full balance), the UPI/UTR reference,
and upload the payment proof. The ledger marks earnings settled oldest-first
and the collector is emailed.

**Two-admin control**: settlements of ₹5000 or more don't execute
immediately — they wait in *awaiting confirmation* until a **different**
admin confirms (the initiator cannot confirm their own settlement). Every
admin action (approvals, reviews, annotation edits, settlements, campaign
and package changes, exports) is recorded in the **Audit log** with actor,
target, and details.

### 3.5 Exports — training vs. testing data

Two purpose-built bundles (plus Google Drive upload of either):

| Bundle | Contents | GPS? | Use |
|---|---|---|---|
| **Training bundle** | Accepted + partially-accepted media with **approved annotations only**, in COCO (polygon) and YOLO (bbox) formats, plus per-video annotation JSON | **No GPS anywhere** | Pothole-detection model training |
| **Raw testing bundle** | Original untouched media + full raw GPS (capture fix, complete tracks) + all annotations with statuses | Yes — complete | Real-world testing of detection models |

Raw footage and raw GPS are **never deleted** from storage, regardless of
exports — the raw record is permanent.

**Extracted frames** — when a video sample is accepted, the exact frame of
every approved annotation is extracted with ffmpeg and shipped in the
training bundle as a labeled image, so videos contribute directly to
image-based detection training.

**Dataset versioning** — every training export records a manifest (sample
IDs, per-file hashes, label counts, split assignment, bundle sha256) in the
*Datasets* page, so any model run can name the exact dataset it trained on.

**Train/val/test splits** — samples are split 80/10/10 deterministically by
*collector + location cell* (geohash), never randomly. The same collector's
captures of the same area always land in the same split, so the model is
never validated on near-duplicates of scenes it trained on.

**Coordinate correction (map-matching)** — with an OSRM server configured,
admins can run a post-processing pass that snaps raw GPS tracks to the road
network and recomputes every video annotation's coordinates from its
timeline position. Corrected coordinates are stored alongside the originals
(never overwriting them) and included in the raw bundle.

**Road-quality index** — accepted annotations aggregate into ~150 m map
cells with a 0–100 severity index (from pothole density), rendered as a
heatmap layer on the admin map — a per-road view of where the worst roads
are.

---

## 4. Operations & configuration

### 4.1 Storage: local disk or S3

Set `STORAGE_DRIVER=local` (default) or `s3` in `apps/api/.env`:

```
STORAGE_DRIVER=s3
S3_BUCKET=pothole-samples
S3_REGION=ap-south-1
# optional, for MinIO / R2 etc:
S3_ENDPOINT=https://...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Chunked uploads always stage on local disk (that's what makes them resumable
on bad networks); after the integrity check passes, the assembled file is
pushed to S3 via multipart upload and the staging copy is removed. Media
streaming, exports, and Drive uploads all read through the same storage
abstraction.

### 4.2 Auth0, Resend, Google Drive

See `apps/api/README.md` for the Auth0 tenant setup (Google social
connection, native + SPA apps, API audience, first-admin bootstrap), Resend
mail configuration, and the Drive service-account setup.

### 4.3 Versioning

The platform version lives in `packages/shared/src/constants.ts`
(`APP_VERSION`) and appears on the mobile splash/profile, the admin sidebar,
and `GET /api/v1/version`.
