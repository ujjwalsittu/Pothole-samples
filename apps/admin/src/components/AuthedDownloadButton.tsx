import { useState } from 'react';
import type { DownloadProgress } from '../api/client';
import { downloadAuthedFile, errorMessage } from '../api/client';

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** Authenticated blob download button with inline progress bar. */
export function AuthedDownloadButton({
  path,
  filename,
  label,
  small,
}: {
  path: string;
  filename: string;
  label: string;
  small?: boolean;
}) {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setStatus('downloading');
    setProgress(null);
    setErr(null);
    try {
      await downloadAuthedFile(path, filename, setProgress);
      setStatus('done');
    } catch (e) {
      setErr(errorMessage(e));
      setStatus('error');
    }
  };

  const pct =
    progress && progress.totalBytes
      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
      : null;

  return (
    <span className="dl-inline">
      <button
        className={`btn btn-primary${small ? ' btn-sm' : ''}`}
        disabled={status === 'downloading'}
        onClick={() => void start()}
      >
        {status === 'downloading' ? 'Downloading…' : label}
      </button>
      {status === 'downloading' ? (
        <span className="progress-wrap">
          <span className="progress-bar">
            <span
              className={`progress-fill${pct === null ? ' indeterminate' : ''}`}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </span>
          <span className="muted small">
            {progress
              ? pct !== null
                ? `${pct}% · ${fmtBytes(progress.receivedBytes)}`
                : `${fmtBytes(progress.receivedBytes)}…`
              : 'Starting…'}
          </span>
        </span>
      ) : null}
      {status === 'done' ? <span className="good-text small">✔ Downloaded</span> : null}
      {status === 'error' && err ? <span className="error-text small">⚠ {err}</span> : null}
    </span>
  );
}
