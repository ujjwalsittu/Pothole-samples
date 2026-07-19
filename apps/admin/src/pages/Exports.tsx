import { useState } from 'react';
import type { DownloadProgress, ExportBundle } from '../api/client';
import { downloadAuthedFile, errorMessage, exportToDrive, isApiError } from '../api/client';
import { Chip } from '../components/ui';

type DownloadKey = 'training' | 'raw' | 'photo' | 'video' | 'all';

interface DlState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  progress: DownloadProgress | null;
  error?: string;
}

const IDLE: DlState = { status: 'idle', progress: null };

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

const PATHS: Record<DownloadKey, { path: string; file: string }> = {
  training: { path: '/api/v1/admin/export/training.zip', file: 'potholecollect-training' },
  raw: { path: '/api/v1/admin/export/raw.zip', file: 'potholecollect-raw-testing' },
  photo: { path: '/api/v1/admin/export/accepted.zip?mediaType=photo', file: 'potholecollect-accepted-photos' },
  video: { path: '/api/v1/admin/export/accepted.zip?mediaType=video', file: 'potholecollect-accepted-videos' },
  all: { path: '/api/v1/admin/export/accepted.zip?mediaType=all', file: 'potholecollect-accepted-all' },
};

export function ExportsPage() {
  const [dl, setDl] = useState<Record<DownloadKey, DlState>>({
    training: IDLE,
    raw: IDLE,
    photo: IDLE,
    video: IDLE,
    all: IDLE,
  });

  const [driveBundle, setDriveBundle] = useState<ExportBundle>('training');
  const [driveStatus, setDriveStatus] = useState<
    'idle' | 'uploading' | 'done' | 'not_configured' | 'error'
  >('idle');
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);

  const startDownload = async (key: DownloadKey) => {
    setDl((prev) => ({ ...prev, [key]: { status: 'downloading', progress: null } }));
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadAuthedFile(PATHS[key].path, `${PATHS[key].file}-${date}.zip`, (progress) =>
        setDl((prev) => ({ ...prev, [key]: { status: 'downloading', progress } })),
      );
      setDl((prev) => ({ ...prev, [key]: { status: 'done', progress: prev[key].progress } }));
    } catch (err) {
      setDl((prev) => ({
        ...prev,
        [key]: { status: 'error', progress: null, error: errorMessage(err) },
      }));
    }
  };

  const startDriveUpload = async () => {
    setDriveStatus('uploading');
    setDriveErr(null);
    setDriveLink(null);
    try {
      const res = await exportToDrive(driveBundle);
      const link = res.folderLink || res.folderUrl || res.link || res.url || null;
      setDriveLink(typeof link === 'string' ? link : null);
      setDriveStatus('done');
    } catch (err) {
      if (isApiError(err) && (err.code === 'NOT_CONFIGURED' || err.code === 'DRIVE_NOT_CONFIGURED')) {
        setDriveStatus('not_configured');
      } else {
        setDriveErr(errorMessage(err));
        setDriveStatus('error');
      }
    }
  };

  const renderProgress = (key: DownloadKey) => {
    const s = dl[key];
    const pct =
      s.progress && s.progress.totalBytes
        ? Math.min(100, Math.round((s.progress.receivedBytes / s.progress.totalBytes) * 100))
        : null;
    return (
      <>
        {s.status === 'downloading' ? (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div
                className={`progress-fill${pct === null ? ' indeterminate' : ''}`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <span className="muted small">
              {s.progress
                ? pct !== null
                  ? `${pct}% · ${fmtBytes(s.progress.receivedBytes)} / ${fmtBytes(s.progress.totalBytes!)}`
                  : `${fmtBytes(s.progress.receivedBytes)} received…`
                : 'Starting…'}
            </span>
          </div>
        ) : null}
        {s.status === 'done' ? <span className="good-text small">✔ Downloaded</span> : null}
        {s.status === 'error' ? <span className="error-text small">⚠ {s.error}</span> : null}
      </>
    );
  };

  const dlButton = (key: DownloadKey, label = '⇩ Download') => (
    <button
      className="btn btn-primary btn-sm"
      disabled={dl[key].status === 'downloading'}
      onClick={() => void startDownload(key)}
    >
      {dl[key].status === 'downloading' ? 'Downloading…' : label}
    </button>
  );

  return (
    <div className="stack">
      <div className="export-cards">
        {/* Training bundle */}
        <div className="card export-bundle">
          <div className="row between wrap gap">
            <h4 className="card-title">🎓 Training bundle</h4>
            <Chip tone="good">No GPS data — training-safe</Chip>
          </div>
          <p className="muted small">
            <Chip tone="good">accepted</Chip> + <Chip tone="teal">partially accepted</Chip> samples with{' '}
            <strong>approved annotations only</strong>. Media + labels in COCO / YOLO format, ready for
            model training. GPS tracks and location metadata are stripped.
          </p>
          <div className="row gap wrap">
            {dlButton('training', '⇩ Download training.zip')}
            {renderProgress('training')}
          </div>
        </div>

        {/* Raw testing bundle */}
        <div className="card export-bundle">
          <div className="row between wrap gap">
            <h4 className="card-title">🧪 Raw testing bundle</h4>
            <Chip tone="warn">contains GPS</Chip>
          </div>
          <p className="muted small">
            Original media + <strong>full GPS tracks</strong> + all annotations (every status), for
            real-world detection testing and field validation. Handle with care — includes location data.
          </p>
          <div className="row gap wrap">
            {dlButton('raw', '⇩ Download raw.zip')}
            {renderProgress('raw')}
          </div>
        </div>

        {/* Legacy accepted zip */}
        <div className="card export-bundle">
          <h4 className="card-title">🗜️ Accepted samples (legacy zip)</h4>
          <p className="muted small">Plain ZIP of accepted media by type — the original export format.</p>
          <div className="legacy-rows">
            <div className="row gap wrap">
              <span className="legacy-label">📷 Photos</span>
              {dlButton('photo')}
              {renderProgress('photo')}
            </div>
            <div className="row gap wrap">
              <span className="legacy-label">🎬 Videos</span>
              {dlButton('video')}
              {renderProgress('video')}
            </div>
            <div className="row gap wrap">
              <span className="legacy-label">🗃️ All</span>
              {dlButton('all')}
              {renderProgress('all')}
            </div>
          </div>
        </div>
      </div>

      {/* Google Drive */}
      <div className="card">
        <h4 className="card-title">☁ Upload to Google Drive</h4>
        <p className="muted small">
          Pushes the chosen bundle to the configured Google Drive folder on the server. Requires Drive
          service-account credentials on the API.
        </p>
        <div className="row gap wrap">
          <label className="field inline">
            <span>Bundle</span>
            <select
              value={driveBundle}
              onChange={(e) => setDriveBundle(e.target.value as ExportBundle)}
              disabled={driveStatus === 'uploading'}
            >
              <option value="training">Training (no GPS)</option>
              <option value="raw">Raw testing (with GPS)</option>
            </select>
          </label>
          <button
            className="btn btn-primary"
            disabled={driveStatus === 'uploading'}
            onClick={() => void startDriveUpload()}
          >
            {driveStatus === 'uploading' ? 'Uploading to Drive…' : 'Upload to Google Drive'}
          </button>
          {driveStatus === 'done' ? (
            driveLink ? (
              <a className="btn btn-ghost" href={driveLink} target="_blank" rel="noreferrer">
                ↗ Open Drive folder
              </a>
            ) : (
              <span className="good-text">✔ Upload started on the server</span>
            )
          ) : null}
        </div>
        {driveStatus === 'not_configured' ? (
          <div className="notice">
            <strong>Google Drive is not configured.</strong>
            <p className="muted small">
              The API has no Drive credentials. Set the Drive service-account environment variables on the
              API server, then try again. ZIP downloads above work regardless.
            </p>
          </div>
        ) : null}
        {driveStatus === 'error' && driveErr ? <p className="error-text">⚠ {driveErr}</p> : null}
      </div>
    </div>
  );
}
