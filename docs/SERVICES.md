# Service Setup — ffmpeg, S3, OSRM, TFLite

How to provision the four optional services the platform uses. Everything
degrades gracefully when absent, so set these up in any order.

---

## 1. ffmpeg (frame extraction & video thumbnails)

**You usually don't need to do anything.** The API resolves ffmpeg in this
order:

1. `FFMPEG_PATH` env var (explicit binary path)
2. `ffmpeg` on the system `PATH`
3. The bundled **`ffmpeg-static`** binary that npm downloads during
   `npm install` — covers Linux x64/arm64 (glibc), macOS (Intel + Apple
   Silicon), and Windows x64

So a plain `npm install` gives every mainstream OS a working ffmpeg with no
system package. Install a system ffmpeg only if you prefer it (it wins over
the bundled one) or if you're on a platform the bundle doesn't cover:

| Platform | Command |
|---|---|
| Debian / Ubuntu | `sudo apt install ffmpeg` |
| Fedora / RHEL | `sudo dnf install ffmpeg-free` (or RPM Fusion `ffmpeg`) |
| Arch | `sudo pacman -S ffmpeg` |
| **Alpine (musl)** — bundle does NOT cover this | `apk add ffmpeg` |
| openSUSE | `sudo zypper install ffmpeg` |
| macOS | `brew install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` or `choco install ffmpeg` |

If npm's binary download was blocked (corporate proxy/air-gapped install),
either install a system ffmpeg from the table or set `FFMPEG_PATH`.

Verify: start the API and look for either no warning (found) or
`[frames] no working ffmpeg` (not found) in the logs.

---

## 2. S3 media storage

The API stores media on local disk by default. Switch to S3 with:

```env
# apps/api/.env
STORAGE_DRIVER=s3
S3_BUCKET=pothole-samples
S3_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Only for non-AWS S3 (MinIO, Cloudflare R2, DigitalOcean Spaces):
# S3_ENDPOINT=https://...
```

Chunked uploads still stage on local disk (that's what makes them resumable
on bad networks); after the integrity check the assembled file is pushed to
S3 with a multipart upload and the staging copy is deleted. Reads (media
streaming, exports, Drive) go through the same driver, so switching drivers
never breaks old samples — each sample remembers where it lives.

### Option A — real AWS S3

1. Create the bucket (keep **Block Public Access ON** — the API streams
   through authenticated endpoints; nothing should be public).
2. Create an IAM user (or role) with this minimal policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
    "Resource": "arn:aws:s3:::pothole-samples/*"
  }]
}
```

3. Put the access key/secret in `apps/api/.env` (or use instance roles and
   omit the keys — the SDK uses the standard credential chain).

### Option B — local MinIO (for development)

```bash
docker compose --profile s3 up -d     # starts MinIO + creates the bucket
```

Console at http://localhost:9001 (login `potholes` / `potholes-secret`).
Env values are pre-written as a comment in `docker-compose.yml` — copy them
into `apps/api/.env`. R2/Spaces work the same way: set `S3_ENDPOINT` to
their endpoint and use their keys.

---

## 3. OSRM (map-matching / coordinate correction)

OSRM snaps raw GPS tracks to the road network so pothole coordinates can be
recomputed more precisely. One-time data prep, then a tiny server.

**Step 1 — download an OSM extract** for your region from
[Geofabrik](https://download.geofabrik.de/) (e.g. `karnataka-latest.osm.pbf`
≈ 150 MB; whole India ≈ 1.4 GB):

```bash
mkdir -p osrm-data
curl -L -o osrm-data/map.osm.pbf \
  https://download.geofabrik.de/asia/india/karnataka-latest.osm.pbf
```

**Step 2 — preprocess** (one time; re-run only to refresh map data):

```bash
docker run --rm -v ./osrm-data:/data osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/map.osm.pbf
docker run --rm -v ./osrm-data:/data osrm/osrm-backend \
  osrm-partition /data/map.osrm
docker run --rm -v ./osrm-data:/data osrm/osrm-backend \
  osrm-customize /data/map.osrm
```

**Step 3 — serve + configure:**

```bash
docker compose --profile osrm up -d          # serves on :5000
```

```env
# apps/api/.env
OSRM_URL=http://localhost:5000
```

Now the **Run map-matching** button in the admin Datasets page works: it
sends each video's track to OSRM's `/match` service, recomputes every
annotation's coordinates on the matched geometry, and stores them as
*corrected* coordinates alongside the originals (originals are never
overwritten). Without `OSRM_URL` the button reports "not configured" — no
other feature is affected.

RAM guide: a state-sized extract runs in ~1–2 GB; all-India needs ~8 GB+
during preprocessing (serving needs less).

---

## 4. TFLite (on-device road/pothole detection)

The mobile app ships with a **sensor-based heuristic advisor** (camera
pitch + movement) that works with zero setup. To upgrade to real frame
analysis you provide a TFLite model:

**Step 1 — get a model.** Two paths:

- **Train your own (recommended once you have data):** export the
  **training bundle** from the admin (it's already YOLO-format with
  deterministic train/val/test splits), then:

  ```bash
  pip install ultralytics
  yolo train model=yolov8n.pt data=dataset.yaml imgsz=224 epochs=100
  yolo export model=runs/detect/train/weights/best.pt format=tflite int8
  ```

  This is exactly what the dataset pipeline was built for — each export's
  manifest records which samples trained which model.

- **Bootstrap from a public model:** any road/pothole classifier or
  detector converted to TFLite works for the guidance use-case while your
  own dataset grows.

**Step 2 — match the app's model contract** (documented in
`apps/mobile/src/detection/tflite.ts`): input `[1, 224, 224, 3]` uint8,
output `[roadProb, potholeProb]`. If your model differs, adapt the adapter
in that file — it's ~30 lines and the only place the shape is assumed.

**Step 3 — install the runtime and model:**

```bash
cd apps/mobile
npm install react-native-fast-tflite   # declared optional; safe to add
npx expo prebuild                      # native module → new dev build
```

Place the model file where the README specifies
(`road-detector.tflite`); the advisor factory detects both the module and
the model at startup and switches from the heuristic automatically — no
code changes. If either is missing, the heuristic keeps running.

**What it does when active:** live "point at the road" guidance gets
frame-accurate, and the app can pre-flag likely potholes during capture —
reducing admin rejections, which is the whole point.
