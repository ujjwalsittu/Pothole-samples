import { useState } from 'react';
import type { DownloadProgress } from '../api/client';
import { downloadAuthedFile, errorMessage, exportToDrive, isApiError } from '../api/client';
import { Chip } from '../components/ui';

type ExportKind = 'photo' | 'video' | 'all';

interface DlState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  progress: DownloadProgress | null;
  error?: string;
}

const EXPORTS: { kind: ExportKind; label: string; icon: string; hint: string }[] = [
  { kind: 'photo', label: 'Accepted photos', icon: '📷', hint: 'ZIP of all accepted photo samples + metadata' },
  { kind: 'video', label: 'Accepted videos', icon: '🎬', hint: 'ZIP of all accepted video samples + GPS tracks' },
  { kind: 'all', label: 'Everything accepted', icon: '🗜️', hint: 'ZIP of all accepted media of both types' },
];

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function ExportsPage() {
  const [dl, setDl] = useState<Record<ExportKind, DlState>>({
    photo: { status: 'idle', progress: null },
    video: { status: 'idle', progress: null },
    all: { status: 'idle', progress: null },
  });

  const [driveStatus, setDriveStatus] = useState<'idle' | 'uploading' | 'done' | 'not_configured' | 'error'>(
    'idle',
  );
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);

  const startDownload = async (kind: ExportKind) => {
    setDl((prev) => ({ ...prev, [kind]: { status: 'downloading', progress: null } }));
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadAuthedFile(
        `/api/v1/admin/export/accepted.zip?mediaType=${kind}`,
        `potholecollect-accepted-${kind}-${date}.zip`,
        (progress) => setDl((prev) => ({ ...prev, [kind]: { status: 'downloading', progress } })),
      );
      setDl((prev) => ({ ...prev, [kind]: { status: 'done', progress: prev[kind].progress } }));
    } catch (err) {
      setDl((prev) => ({
        ...prev,
        [kind]: { status: 'error', progress: null, error: errorMessage(err) },
      }));
    }
  };

  const startDriveUpload = async () => {
    setDriveStatus('uploading');
    setDriveErr(null);
    setDriveLink(null);
    try {
      const res = await exportToDrive();
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

  return (
    <div className="stack">
      <div className="card">
        <h4 className="card-title">Download accepted dataset</h4>
        <p className="muted small">
          Authenticated ZIP downloads of every <Chip tone="good">accepted</Chip> sample. Large exports
          stream with progress — keep the tab open until the save dialog appears.
        </p>
        <div className="export-grid">
          {EXPORTS.map(({ kind, label, icon, hint }) => {
            const s = dl[kind];
            const pct =
              s.progress && s.progress.totalBytes
                ? Math.min(100, Math.round((s.progress.receivedBytes / s.progress.totalBytes) * 100))
                : null;
            return (
              <div key={kind} className="export-card">
                <div className="export-icon">{icon}</div>
                <div className="export-main">
                  <strong>{label}</strong>
                  <span className="muted small">{hint}</span>
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
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={s.status === 'downloading'}
                  onClick={() => void startDownload(kind)}
                >
                  {s.status === 'downloading' ? 'Downloading…' : '⇩ Download'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h4 className="card-title">Upload to Google Drive</h4>
        <p className="muted small">
          Pushes the accepted dataset to the configured Google Drive folder on the server. Requires
          Drive service-account credentials on the API.
        </p>
        <div className="row gap wrap">
          <button
            className="btn btn-primary"
            disabled={driveStatus === 'uploading'}
            onClick={() => void startDriveUpload()}
          >
            {driveStatus === 'uploading' ? 'Uploading to Drive…' : '☁ Upload to Google Drive'}
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
              The API has no Drive credentials. Set the Drive service-account environment variables on
              the API server, then try again. ZIP downloads above work regardless.
            </p>
          </div>
        ) : null}
        {driveStatus === 'error' && driveErr ? <p className="error-text">⚠ {driveErr}</p> : null}
      </div>
    </div>
  );
}
