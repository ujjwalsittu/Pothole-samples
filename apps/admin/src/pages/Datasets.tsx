import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DatasetManifest } from '@pothole/shared';
import { DATASET_SPLIT } from '@pothole/shared';
import {
  datasetManifestPath,
  errorMessage,
  isApiError,
  listDatasets,
  runMapMatch,
} from '../api/client';
import { AuthedDownloadButton } from '../components/AuthedDownloadButton';
import { Chip, EmptyState, ErrorState, LoadingPanel, formatDate } from '../components/ui';

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetManifest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [mmStatus, setMmStatus] = useState<'idle' | 'running' | 'done' | 'not_configured' | 'error'>('idle');
  const [mmResult, setMmResult] = useState<string | null>(null);
  const [mmErr, setMmErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDatasets(null);
    setError(null);
    listDatasets()
      .then((d) => {
        if (!cancelled) {
          setDatasets(
            [...d].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const startMapMatch = async () => {
    setMmStatus('running');
    setMmErr(null);
    setMmResult(null);
    try {
      const res = await runMapMatch();
      const matched = res.matched ?? res.matchedCount ?? res.processed ?? null;
      setMmResult(
        matched != null ? `Map-matching finished — ${String(matched)} track(s) snapped to roads.` : 'Map-matching finished.',
      );
      setMmStatus('done');
    } catch (err) {
      if (isApiError(err) && (err.code === 'NOT_CONFIGURED' || err.status === 501)) {
        setMmStatus('not_configured');
      } else {
        setMmErr(errorMessage(err));
        setMmStatus('error');
      }
    }
  };

  return (
    <div className="stack">
      {/* bundles */}
      <div className="export-cards">
        <div className="card export-bundle">
          <div className="row between wrap gap">
            <h4 className="card-title">🎓 Training bundle</h4>
            <Chip tone="good">No GPS — training-safe</Chip>
          </div>
          <p className="muted small">
            COCO/YOLO labels with <strong>train / val / test</strong> splits (
            {Math.round(DATASET_SPLIT.TRAIN * 100)}/{Math.round(DATASET_SPLIT.VAL * 100)}/
            {Math.round(DATASET_SPLIT.TEST * 100)}, split by collector + geohash-
            {DATASET_SPLIT.GEO_PRECISION} bucket, never randomly) and a <span className="mono">manifest.json</span>.
            Every export is recorded below.
          </p>
          <AuthedDownloadButton
            path="/api/v1/admin/export/training.zip"
            filename={`potholecollect-training-${new Date().toISOString().slice(0, 10)}.zip`}
            label="⇩ Download training.zip"
          />
        </div>
        <div className="card export-bundle">
          <div className="row between wrap gap">
            <h4 className="card-title">🧪 Raw testing bundle</h4>
            <Chip tone="warn">contains GPS</Chip>
          </div>
          <p className="muted small">
            Original media + full GPS tracks + all annotations, for real-world detection testing. More
            formats on the <Link to="/exports">Exports page</Link>.
          </p>
          <AuthedDownloadButton
            path="/api/v1/admin/export/raw.zip"
            filename={`potholecollect-raw-${new Date().toISOString().slice(0, 10)}.zip`}
            label="⇩ Download raw.zip"
          />
        </div>
        <div className="card export-bundle">
          <h4 className="card-title">🛣️ Map-matching (OSRM)</h4>
          <p className="muted small">
            Snap recorded GPS tracks to the road network — improves pothole coordinates before export.
          </p>
          <div className="row gap wrap">
            <button className="btn" disabled={mmStatus === 'running'} onClick={() => void startMapMatch()}>
              {mmStatus === 'running' ? 'Running map-matching…' : 'Run map-matching (OSRM)'}
            </button>
          </div>
          {mmStatus === 'done' && mmResult ? <p className="good-text small">✔ {mmResult}</p> : null}
          {mmStatus === 'not_configured' ? (
            <div className="notice">
              <strong>OSRM is not configured.</strong>
              <p className="muted small">
                The API has no OSRM endpoint configured — set it up on the server to enable map-matching.
                Exports work regardless (raw GPS is used).
              </p>
            </div>
          ) : null}
          {mmStatus === 'error' && mmErr ? <p className="error-text small">⚠ {mmErr}</p> : null}
        </div>
      </div>

      {/* export history */}
      <div className="card">
        <div className="row between wrap gap">
          <h4 className="card-title">Export history</h4>
          <button className="btn btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
            ↻ Refresh
          </button>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : datasets === null ? (
          <LoadingPanel label="Loading export history…" />
        ) : datasets.length === 0 ? (
          <EmptyState
            title="No dataset exports yet"
            hint="Each training.zip download is versioned here with its manifest."
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>By</th>
                  <th>Bundle sha256</th>
                  <th>Samples</th>
                  <th>Annotations</th>
                  <th>Splits</th>
                  <th>Labels</th>
                  <th>Manifest</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id}>
                    <td className="muted nowrap">{formatDate(d.createdAt)}</td>
                    <td>{d.createdBy}</td>
                    <td className="mono small" title={d.bundleSha256}>
                      {d.bundleSha256?.slice(0, 12) ?? '—'}…
                    </td>
                    <td>{d.sampleCount}</td>
                    <td>{d.annotationCount}</td>
                    <td>
                      <span className="row gap wrap">
                        <Chip tone="good">train {d.splitCounts?.train ?? 0}</Chip>
                        <Chip tone="info">val {d.splitCounts?.val ?? 0}</Chip>
                        <Chip tone="warn">test {d.splitCounts?.test ?? 0}</Chip>
                      </span>
                    </td>
                    <td>
                      <span className="row gap wrap label-chips">
                        {Object.entries(d.labelCounts ?? {}).map(([label, count]) => (
                          <Chip key={label} tone="neutral">
                            {label}: {count}
                          </Chip>
                        ))}
                        {Object.keys(d.labelCounts ?? {}).length === 0 ? <span className="muted">—</span> : null}
                      </span>
                    </td>
                    <td>
                      <AuthedDownloadButton
                        path={datasetManifestPath(d.id)}
                        filename={`manifest-${d.id}.json`}
                        label="⇩ manifest.json"
                        small
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
