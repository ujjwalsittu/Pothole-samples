# PotholeCollect Admin Dashboard

Admin web dashboard for the pothole data-collection platform.
Vite + React 18 + TypeScript (strict) + react-router-dom v6 + Auth0, with a
hand-rolled dark theme (no UI kit). Business rules and types come straight from
the shared workspace package [`@pothole/shared`](../../packages/shared).

Powered by Threemates Tech Ventures · v1.0.0

## Features

- **Overview** — pending-approval / pending-review counts, accepted & rejected
  totals, total payable balance across collectors, and a recent-activity feed
  with deep links into sample detail.
- **Approvals** — pending signups (photo, name, email, student/professional,
  UPI ID, signup date) with Approve / Reject (required reason). Tabs for
  approved and rejected users; on approved users: change collector status
  (student / professional / **owner** — the admin-only promotion) and
  promote-to-admin / revoke-admin role controls.
- **Review Queue** — the core page. Queue of `pending_review` samples on the
  left; full detail on the right:
  - **Photos**: auth-streamed image with annotation polygons rendered as a
    scaled SVG overlay (normalized [0..1] coords), label chips, and the
    per-annotation estimates table (diameter, area, volume, material kg, road
    type/width).
  - **Videos**: auth-streamed `<video>` player plus the GPS track drawn on an
    inline SVG map (no external tiles — CSP-friendly). A moving dot follows
    the track in sync with `video.currentTime` via
    `coordinateAtVideoTime()` from `@pothole/shared`; clicking an annotation
    seeks the video and highlights its interpolated coordinate. Real avg/max
    speed and duration are shown against the true 60–65 km/h window
    (the 60-only speedometer fiction is user-facing only).
  - Auto-evaluated validation checklist (duration ≥ 40 s, ≥ 2 potholes, speed
    window, GPS accuracy ≤ 15 m, no mock location) plus the manual
    content checklist from `CONTENT_GUIDELINES.avoid`.
  - Accept (shows the exact ₹ credit = package payout / quota) or Reject with
    preset reasons + free text; the queue auto-advances after each decision.
- **Samples** — filterable table of all samples (state, media type, user
  search) with a read-only drill-in drawer reusing the review detail panel.
- **Settlements** — per-user payable balances (earned / settled / balance),
  "Settle" modal (amount prefilled with full balance, UTR reference, payment
  proof upload → multipart), settlement history with authenticated proof
  downloads, and a per-user full ledger drawer with running balance.
- **Annotation editing (admin)** — the review panel is a full annotator for
  photos and paused video frames: draw new polygons (click-to-add, Enter/dbl-click
  to close), drag vertices, insert via midpoint handles, double-click to delete
  a vertex, per-annotation label dropdown, Accept/Reject status toggles
  (green/red/amber), collector-vs-admin badges — all persisted optimistically
  with rollback on API errors. Review decisions: Accept all / Partially accept
  (requires ≥1 accepted and ≥1 rejected annotation) / Reject with reason.
- **Map** — Leaflet + OpenStreetMap view of every sample (colored by state,
  popups with authed thumbnails and detail links), toggleable campaign-zone
  and road-quality heatmap layers (severity green→red).
- **Campaigns** — geo-targeted boost zones with a click-to-draw polygon editor
  on the map (drag markers to adjust, right-click to remove a vertex), boost
  multiplier, active flag and date window; delete with confirmation.
- **Packages** — earnings-package management (quotas, payout, chaining via
  next-package) plus per-user package assignment on the Approvals page.
- **Leaderboard** — month/all-time collector rankings with accepted counts,
  earnings and streak days.
- **Datasets** — versioned training exports with manifest history (sha256,
  sample/annotation counts, train/val/test split badges, label counts),
  manifest.json downloads, training/raw bundle downloads and the OSRM
  map-matching trigger (graceful NOT_CONFIGURED notice).
- **Settlements two-admin flow** — settlements ≥ ₹5000 wait for a second
  admin's confirmation; the initiator's Confirm button is disabled with an
  explanatory tooltip, and history shows who confirmed.
- **Audit log** — filterable admin action trail (server-side action prefix,
  client-side actor filter), pretty-printed JSON detail expanders and
  cursor-based "load more".
- **Exports** — training bundle (no GPS, training-safe), raw testing bundle
  (full GPS + all annotations) and legacy accepted ZIPs, all as authenticated
  downloads with live progress bars; Upload-to-Google-Drive with a bundle
  choice (training/raw) and a clear notice when the API has no Drive
  credentials (`NOT_CONFIGURED`).

## Setup

From the repo root (npm workspaces):

```bash
npm install --workspace apps/admin
npm run admin            # → vite dev server on http://localhost:5173
```

or inside `apps/admin`:

```bash
npm run dev              # vite --port 5173
npm run build            # tsc -b && vite build  → dist/
npm run preview          # serve the production build
```

The API is expected at `http://localhost:4000` (override with `VITE_API_URL`).

## Environment

Copy `.env.example` → `.env` and fill in:

| Variable               | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `VITE_API_URL`         | API base URL (default `http://localhost:4000`)       |
| `VITE_AUTH0_DOMAIN`    | Auth0 tenant domain — **leave unset for dev bypass** |
| `VITE_AUTH0_CLIENT_ID` | Auth0 SPA application client ID                      |
| `VITE_AUTH0_AUDIENCE`  | Auth0 API audience (access-token audience)           |
| `VITE_DEV_SUB`         | dev-bypass subject header (default `dev\|admin`)     |
| `VITE_DEV_EMAIL`       | dev-bypass email header (default `admin@dev.local`)  |

### Auth0 SPA application setup

1. Auth0 Dashboard → Applications → **Create Application** → *Single Page
   Application*.
2. Configure the app (use your deployed origin instead of localhost in prod):
   - **Allowed Callback URLs**: `http://localhost:5173`
   - **Allowed Logout URLs**: `http://localhost:5173`
   - **Allowed Web Origins**: `http://localhost:5173`
3. Create (or reuse) the **API** in Auth0 with an identifier — that identifier
   is `VITE_AUTH0_AUDIENCE` and must match the API server's expected audience.
4. Put the tenant domain, client ID and audience into `.env`.

The dashboard uses `@auth0/auth0-react` with redirect login; every API call
attaches `Authorization: Bearer <access token>` via `getAccessTokenSilently()`.
Media and ZIP endpoints are fetched with the same header and turned into blob
URLs (query-string tokens are not supported by the API).

### Dev bypass (no Auth0 tenant needed)

If `VITE_AUTH0_DOMAIN` is **unset**, the app skips the Auth0 provider entirely
and sends `x-dev-sub` / `x-dev-email` headers on every request — matching the
API's `DEV_AUTH_BYPASS` mode — so the dashboard runs locally without a tenant.
A "DEV BYPASS" chip is shown in the topbar.

## Access control

After login the app calls `GET /api/v1/me`; only users whose role is `admin`
or `owner` get past the guard — everyone else sees a "Not an admin" screen
with a sign-out option.

## Notes

- Sample state machine, speed/duration/GPS rules, content guidelines, payout
  quotas, labels and estimation helpers are all imported from
  `@pothole/shared` — nothing is duplicated here.
- The review panel's GPS track view is a self-contained SVG projection
  (works offline, no tiles); the dedicated Map/Campaigns pages use Leaflet
  with OpenStreetMap tiles and link back and forth ("open in map").
- Sample thumbnails are lazy-loaded authenticated blobs
  (`/media/:id/thumb`) with a glyph fallback when the endpoint is missing.
- The earnings ledger view tolerates a missing `/earnings/ledger` route
  (404 → graceful empty state).
