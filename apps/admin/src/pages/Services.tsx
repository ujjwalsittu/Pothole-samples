import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelRelease, OsrmStatus } from '@pothole/shared';
import type { UploadProgress } from '../api/client';
import {
  activateModel,
  errorMessage,
  getLatestModel,
  getOsrmStatus,
  isApiError,
  listModels,
  osrmDownload,
  osrmPreprocess,
  osrmServe,
  osrmStop,
  runMapMatch,
  uploadModel,
} from '../api/client';
import { Chip, EmptyState, ErrorState, LoadingPanel, Spinner, formatDate } from '../components/ui';

const GEOFABRIK_EXAMPLE = 'https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf';
const PREPROCESS_STAGES = ['extract', 'partition', 'customize'] as const;

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function ServicesPage() {
  return (
    <div className="stack">
      <OsrmPanel />
      <ModelsPanel />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* OSRM manager                                                        */
/* ------------------------------------------------------------------ */

function OsrmPanel() {
  const [status, setStatus] = useState<OsrmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState(GEOFABRIK_EXAMPLE);
  const [busy, setBusy] = useState<'download' | 'preprocess' | 'serve' | 'stop' | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [runnerUnavailable, setRunnerUnavailable] = useState(false);

  const [mmStatus, setMmStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [mmMsg, setMmMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getOsrmStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live polling (2 s) while anything is in progress.
  const inProgress = !!status && (status.download.inProgress || status.preprocess.inProgress);
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [inProgress, load]);

  const act = useCallback(
    async (kind: 'download' | 'preprocess' | 'serve' | 'stop') => {
      setBusy(kind);
      setActionErr(null);
      try {
        if (kind === 'download') await osrmDownload(downloadUrl.trim());
        else if (kind === 'preprocess') await osrmPreprocess();
        else if (kind === 'serve') await osrmServe();
        else await osrmStop();
        await load();
      } catch (err) {
        if (kind === 'preprocess' && isApiError(err) && (err.code === 'OSRM_RUNNER_UNAVAILABLE' || err.status === 501)) {
          setRunnerUnavailable(true);
        } else {
          setActionErr(errorMessage(err));
        }
      } finally {
        setBusy(null);
      }
    },
    [downloadUrl, load],
  );

  const startMapMatch = async () => {
    setMmStatus('running');
    setMmMsg(null);
    try {
      const res = await runMapMatch();
      const matched = res.matched ?? res.matchedCount ?? res.processed ?? null;
      setMmMsg(matched != null ? `${String(matched)} track(s) snapped to roads.` : 'Map-matching finished.');
      setMmStatus('done');
    } catch (err) {
      setMmMsg(errorMessage(err));
      setMmStatus('error');
    }
  };

  if (error && !status) {
    return (
      <div className="card">
        <h4 className="card-title">🛣️ OSRM map-matching service</h4>
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!status) {
    return (
      <div className="card">
        <h4 className="card-title">🛣️ OSRM map-matching service</h4>
        <LoadingPanel label="Checking OSRM status…" />
      </div>
    );
  }

  const dl = status.download;
  const pp = status.preprocess;
  const sv = status.serve;
  const dlPct = dl.inProgress && dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null;
  const showRunnerGuide = status.runner === 'unavailable' || runnerUnavailable;

  return (
    <div className="card">
      <div className="row between wrap gap">
        <h4 className="card-title">🛣️ OSRM map-matching service</h4>
        <span className="row gap">
          <Chip
            tone={status.runner === 'binaries' ? 'good' : status.runner === 'docker' ? 'info' : 'bad'}
          >
            runner: {status.runner}
          </Chip>
          {sv.running ? <Chip tone="good">serving</Chip> : <Chip tone="neutral">stopped</Chip>}
          <button className="btn btn-sm btn-ghost" onClick={() => void load()}>
            ↻ Refresh
          </button>
        </span>
      </div>
      <p className="muted small">
        OSRM snaps recorded GPS tracks to the road network before export. Effective endpoint:{' '}
        {status.effectiveUrl ? <span className="mono">{status.effectiveUrl}</span> : <em>none yet</em>}.
      </p>
      {status.external ? (
        <div className="notice">
          <span className="small">
            ℹ <strong>Externally managed:</strong> <span className="mono">OSRM_URL</span> points at an
            external server — the local download/preprocess/serve steps below are not needed on this host.
          </span>
        </div>
      ) : null}
      {showRunnerGuide ? (
        <div className="notice">
          <strong>OSRM runner unavailable on the API host.</strong>
          <p className="muted small">
            Preprocessing/serving needs one of (see <span className="mono">SERVICES.md</span>): install the{' '}
            <span className="mono">osrm-backend</span> binaries (<span className="mono">osrm-extract</span>,{' '}
            <span className="mono">osrm-partition</span>, <span className="mono">osrm-customize</span>,{' '}
            <span className="mono">osrm-routed</span>) on PATH, <em>or</em> install Docker (the OSRM image is
            used automatically). Alternatively set <span className="mono">OSRM_URL</span> to an external
            OSRM server. Restart the API after installing.
          </p>
        </div>
      ) : null}
      {actionErr ? <p className="error-text">⚠ {actionErr}</p> : null}

      <div className="osrm-steps">
        {/* Step 1 — download region */}
        <div className={`osrm-step${status.dataDownloaded ? ' done' : ''}`}>
          <div className="osrm-step-head">
            <span className="step-no">{status.dataDownloaded ? '✔' : '1'}</span>
            <strong>Download region extract (.osm.pbf)</strong>
          </div>
          <p className="muted small">
            Pick your region from{' '}
            <a href="https://download.geofabrik.de/" target="_blank" rel="noreferrer">
              Geofabrik
            </a>{' '}
            — smaller regions preprocess much faster.
          </p>
          <div className="row gap wrap">
            <input
              className="grow-input"
              type="url"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder={GEOFABRIK_EXAMPLE}
              disabled={dl.inProgress}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={busy !== null || dl.inProgress || !downloadUrl.trim()}
              onClick={() => void act('download')}
            >
              {dl.inProgress ? 'Downloading…' : status.dataDownloaded ? 'Re-download' : '⇩ Download'}
            </button>
          </div>
          {dl.inProgress ? (
            <div className="progress-wrap">
              <div className="progress-bar">
                <div
                  className={`progress-fill${dlPct === null ? ' indeterminate' : ''}`}
                  style={dlPct !== null ? { width: `${dlPct}%` } : undefined}
                />
              </div>
              <span className="muted small">
                {dlPct !== null
                  ? `${dlPct}% · ${fmtBytes(dl.receivedBytes)} / ${fmtBytes(dl.totalBytes!)}`
                  : `${fmtBytes(dl.receivedBytes)} received…`}
                {dl.url ? ` · ${dl.url}` : ''}
              </span>
            </div>
          ) : null}
          {dl.error ? <p className="error-text small">⚠ {dl.error}</p> : null}
          {status.dataDownloaded && !dl.inProgress ? (
            <p className="good-text small">✔ Region data on disk{dl.url ? ` (${dl.url})` : ''}</p>
          ) : null}
        </div>

        {/* Step 2 — preprocess */}
        <div className={`osrm-step${status.preprocessed ? ' done' : ''}`}>
          <div className="osrm-step-head">
            <span className="step-no">{status.preprocessed ? '✔' : '2'}</span>
            <strong>Preprocess (build routing graph)</strong>
          </div>
          <div className="row gap wrap">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy !== null || pp.inProgress || !status.dataDownloaded || status.runner === 'unavailable'}
              title={!status.dataDownloaded ? 'Download a region first' : undefined}
              onClick={() => void act('preprocess')}
            >
              {pp.inProgress ? 'Preprocessing…' : status.preprocessed ? 'Re-run preprocess' : 'Preprocess'}
            </button>
            <span className="stage-track">
              {PREPROCESS_STAGES.map((stage, i) => {
                const activeIdx = pp.stage ? PREPROCESS_STAGES.indexOf(pp.stage as (typeof PREPROCESS_STAGES)[number]) : -1;
                const state = status.preprocessed
                  ? 'done'
                  : pp.inProgress && i < activeIdx
                    ? 'done'
                    : pp.inProgress && i === activeIdx
                      ? 'active'
                      : 'todo';
                return (
                  <span key={stage} className={`stage stage-${state}`}>
                    {state === 'active' ? <Spinner small /> : state === 'done' ? '✔' : '·'} {stage}
                    {i < PREPROCESS_STAGES.length - 1 ? <span className="stage-arrow">→</span> : null}
                  </span>
                );
              })}
            </span>
          </div>
          {pp.error ? <p className="error-text small">⚠ {pp.error}</p> : null}
        </div>

        {/* Step 3 — serve */}
        <div className={`osrm-step${sv.running ? ' done' : ''}`}>
          <div className="osrm-step-head">
            <span className="step-no">{sv.running ? '✔' : '3'}</span>
            <strong>Serve</strong>
          </div>
          <div className="row gap wrap">
            {sv.running ? (
              <>
                <Chip tone="good">
                  running{sv.pid != null ? ` · pid ${sv.pid}` : ''}
                </Chip>
                {sv.startedAt ? <span className="muted small">since {formatDate(sv.startedAt)}</span> : null}
                <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => void act('stop')}>
                  {busy === 'stop' ? 'Stopping…' : '■ Stop'}
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy !== null || !status.preprocessed || status.runner === 'unavailable'}
                title={!status.preprocessed ? 'Preprocess the region first' : undefined}
                onClick={() => void act('serve')}
              >
                {busy === 'serve' ? 'Starting…' : '▶ Start osrm-routed'}
              </button>
            )}
          </div>
          {sv.error ? <p className="error-text small">⚠ {sv.error}</p> : null}
        </div>
      </div>

      {status.effectiveUrl && (sv.running || status.external) ? (
        <div className="row gap wrap mapmatch-shortcut">
          <button className="btn" disabled={mmStatus === 'running'} onClick={() => void startMapMatch()}>
            {mmStatus === 'running' ? 'Running map-matching…' : '🛣 Run map-matching now'}
          </button>
          {mmStatus === 'done' && mmMsg ? <span className="good-text small">✔ {mmMsg}</span> : null}
          {mmStatus === 'error' && mmMsg ? <span className="error-text small">⚠ {mmMsg}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* On-device model releases                                            */
/* ------------------------------------------------------------------ */

function ModelsPanel() {
  const [models, setModels] = useState<ModelRelease[] | null>(null);
  const [latest, setLatest] = useState<ModelRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<UploadProgress | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activating, setActivating] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setError(null);
    listModels()
      .then((m) => {
        if (!cancelled) setModels([...m].sort((a, b) => b.version - a.version));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    getLatestModel()
      .then((m) => {
        if (!cancelled) setLatest(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    setUploadPct(null);
    try {
      await uploadModel(file, notes.trim(), setUploadPct);
      setFile(null);
      setNotes('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      refresh();
    } catch (err) {
      setUploadErr(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const activate = async (id: string) => {
    setActivating(id);
    setActErr(null);
    try {
      await activateModel(id);
      refresh();
    } catch (err) {
      setActErr(errorMessage(err));
    } finally {
      setActivating(null);
    }
  };

  const pct = uploadPct ? Math.min(100, Math.round((uploadPct.sentBytes / uploadPct.totalBytes) * 100)) : null;

  return (
    <div className="card">
      <div className="row between wrap gap">
        <h4 className="card-title">🤖 On-device model releases</h4>
        <span className="row gap">
          {latest ? <Chip tone="accent">collectors run v{latest.version}</Chip> : null}
          <button className="btn btn-sm btn-ghost" onClick={refresh}>
            ↻ Refresh
          </button>
        </span>
      </div>
      <p className="muted small">
        The <strong>active</strong> release is fetched by the mobile app automatically (OTA) on launch.
        Expected TFLite contract: input <span className="mono">[1, 224, 224, 3]</span> u8 → output{' '}
        <span className="mono">[roadProb, potholeProb]</span>.
      </p>

      {/* upload */}
      <div className="upload-box">
        <div className="row gap wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".tflite"
            disabled={uploading}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <input
            className="grow-input"
            type="text"
            value={notes}
            disabled={uploading}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Release notes (training data version, metrics…)"
          />
          <button className="btn btn-primary btn-sm" disabled={!file || uploading} onClick={() => void upload()}>
            {uploading ? 'Uploading…' : '⇧ Upload release'}
          </button>
        </div>
        {file && !uploading ? (
          <span className="muted small">
            {file.name} ({fmtBytes(file.size)})
          </span>
        ) : null}
        {uploading ? (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div
                className={`progress-fill${pct === null ? ' indeterminate' : ''}`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <span className="muted small">
              {uploadPct ? `${pct}% · ${fmtBytes(uploadPct.sentBytes)} / ${fmtBytes(uploadPct.totalBytes)}` : 'Starting…'}
            </span>
          </div>
        ) : null}
        {uploadErr ? <p className="error-text small">⚠ {uploadErr}</p> : null}
      </div>

      {/* releases table */}
      {actErr ? <p className="error-text small">⚠ {actErr}</p> : null}
      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : models === null ? (
        <LoadingPanel label="Loading releases…" />
      ) : models.length === 0 ? (
        <EmptyState title="No model releases yet" hint="Upload a .tflite build above to publish the first OTA release." />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>File</th>
                <th>Size</th>
                <th>sha256</th>
                <th>Notes</th>
                <th>Uploaded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className={m.active ? 'selected' : ''}>
                  <td>
                    <strong>v{m.version}</strong>
                  </td>
                  <td className="mono small">{m.filename}</td>
                  <td>{fmtBytes(m.sizeBytes)}</td>
                  <td className="mono small" title={m.sha256}>
                    {m.sha256.slice(0, 12)}…
                  </td>
                  <td className="muted small">{m.notes || '—'}</td>
                  <td className="muted small">
                    {m.uploadedBy}
                    <div>{formatDate(m.createdAt)}</div>
                  </td>
                  <td>
                    {m.active ? (
                      <Chip tone="good">ACTIVE</Chip>
                    ) : (
                      <button
                        className="btn btn-sm"
                        disabled={activating !== null}
                        onClick={() => void activate(m.id)}
                      >
                        {activating === m.id ? 'Activating…' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
