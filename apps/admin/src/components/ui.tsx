import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function Spinner({ small }: { small?: boolean }) {
  return <div className={small ? 'spinner spinner-sm' : 'spinner'} aria-label="Loading" />;
}

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-panel">
      <Spinner />
      <p className="muted">{label}</p>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state-panel">
      <div className="empty-glyph">∅</div>
      <p>{title}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-panel error-panel">
      <p className="error-text">⚠ {message}</p>
      {onRetry ? (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent' | 'info';
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function stateTone(state: string): 'neutral' | 'good' | 'bad' | 'warn' | 'accent' | 'info' {
  switch (state) {
    case 'accepted':
    case 'approved':
    case 'settled':
      return 'good';
    case 'rejected':
    case 'auto_rejected':
    case 'suspended':
      return 'bad';
    case 'pending_review':
    case 'pending_approval':
    case 'initiated':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'accent' | 'good' | 'bad' | 'warn';
}) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` stat-${tone}` : ''}`}>{value}</div>
      {hint ? <div className="muted small">{hint}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ url, name }: { url?: string | null; name: string }) {
  if (url) return <img className="avatar" src={url} alt={name} referrerPolicy="no-referrer" />;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return <div className="avatar avatar-fallback">{initials}</div>;
}

export function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
