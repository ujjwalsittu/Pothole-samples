import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WithdrawalState } from '@pothole/shared';
import { SETTLEMENT_CONFIRM_THRESHOLD_INR } from '@pothole/shared';
import type { BalanceInfo, SettlementRow, WithdrawalRow } from '../api/client';
import {
  approveWithdrawal,
  downloadAuthedFile,
  errorMessage,
  getUserBalance,
  listSettlements,
  listWithdrawals,
  rejectWithdrawal,
} from '../api/client';
import {
  Chip,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Modal,
  formatDate,
  formatInr,
} from '../components/ui';

const W_TABS: { key: WithdrawalState; label: string }[] = [
  { key: 'requested', label: 'Requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'paid', label: 'Paid' },
];

function userLabel(w: WithdrawalRow): string {
  return w.user?.fullName || w.userName || w.user?.email || w.userEmail || w.userId;
}

export function WithdrawalsSection() {
  const [tab, setTab] = useState<WithdrawalState>('requested');
  const [rows, setRows] = useState<WithdrawalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [balances, setBalances] = useState<Record<string, BalanceInfo | null>>({});
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WithdrawalRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    listWithdrawals(tab)
      .then(async (w) => {
        if (cancelled) return;
        const sorted = [...w].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setRows(sorted);
        if (tab === 'requested') {
          // Active-balance check per requester (tolerant).
          const ids = [...new Set(sorted.map((r) => r.userId))];
          const results = await Promise.all(
            ids.map(async (id) => [id, await getUserBalance(id).catch(() => null)] as const),
          );
          if (!cancelled) setBalances(Object.fromEntries(results));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  // Settlement rows for proof links on approved/paid withdrawals.
  useEffect(() => {
    let cancelled = false;
    if (tab !== 'paid' && tab !== 'approved') return;
    listSettlements()
      .then((s) => {
        if (!cancelled) setSettlements(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  const settlementById = useMemo(() => {
    const m = new Map<string, SettlementRow>();
    for (const s of settlements) m.set(s.id, s);
    return m;
  }, [settlements]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const doApprove = useCallback(
    async (w: WithdrawalRow) => {
      setBusyId(w.id);
      setActionErr(null);
      try {
        await approveWithdrawal(w.id);
        refresh();
      } catch (err) {
        setActionErr(errorMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const doReject = useCallback(async () => {
    if (!rejectTarget) return;
    const note = rejectNote.trim();
    if (!note) {
      setActionErr('A note is required — the collector sees why.');
      return;
    }
    setBusyId(rejectTarget.id);
    setActionErr(null);
    try {
      await rejectWithdrawal(rejectTarget.id, note);
      setRejectTarget(null);
      setRejectNote('');
      refresh();
    } catch (err) {
      setActionErr(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }, [rejectTarget, rejectNote, refresh]);

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div className="tabs">
          {W_TABS.map((t) => (
            <button
              key={t.key}
              className={`tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>

      {tab === 'requested' ? (
        <p className="muted small">
          Approving runs the settlement flow — amounts of {formatInr(SETTLEMENT_CONFIRM_THRESHOLD_INR)}{' '}
          or more still need a <strong>second admin's confirmation</strong> on the Settlements tab before
          they are paid.
        </p>
      ) : null}
      {actionErr ? <p className="error-text">⚠ {actionErr}</p> : null}

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : rows === null ? (
        <LoadingPanel label="Loading withdrawals…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`No ${tab} withdrawals`}
          hint={tab === 'requested' ? 'Collector withdrawal requests land here.' : undefined}
        />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Collector</th>
                  <th>Amount</th>
                  <th>UPI ID</th>
                  <th>Requested</th>
                  {tab === 'requested' ? <th>Active balance</th> : null}
                  {tab !== 'requested' ? <th>Decided</th> : null}
                  {tab === 'rejected' ? <th>Note</th> : null}
                  {tab === 'approved' || tab === 'paid' ? <th>Settlement</th> : null}
                  {tab === 'requested' ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const bal = balances[w.userId];
                  const covered = bal ? w.amountInr <= bal.activeInr : null;
                  const settlement = w.settlementId ? settlementById.get(w.settlementId) : undefined;
                  return (
                    <tr key={w.id}>
                      <td>
                        <strong>{userLabel(w)}</strong>
                      </td>
                      <td>
                        <strong className="accent-text">{formatInr(w.amountInr)}</strong>
                        {w.amountInr >= SETTLEMENT_CONFIRM_THRESHOLD_INR ? (
                          <div>
                            <Chip tone="warn">needs 2nd admin</Chip>
                          </div>
                        ) : null}
                      </td>
                      <td className="mono small">{w.upiId}</td>
                      <td className="muted small">{formatDate(w.createdAt)}</td>
                      {tab === 'requested' ? (
                        <td>
                          {bal === undefined ? (
                            <span className="muted small">checking…</span>
                          ) : bal === null ? (
                            <span className="muted small">unknown</span>
                          ) : covered ? (
                            <Chip tone="good">✔ covered ({formatInr(bal.activeInr)} active)</Chip>
                          ) : (
                            <Chip tone="bad">✘ exceeds active {formatInr(bal.activeInr)}</Chip>
                          )}
                        </td>
                      ) : null}
                      {tab !== 'requested' ? (
                        <td className="muted small">
                          {w.decidedByName || w.decidedBy || '—'}
                          <div>{formatDate(w.decidedAt)}</div>
                        </td>
                      ) : null}
                      {tab === 'rejected' ? <td className="muted small">{w.note || '—'}</td> : null}
                      {tab === 'approved' || tab === 'paid' ? (
                        <td>
                          {w.settlementId ? (
                            <span className="row gap wrap">
                              <span className="mono small">{w.settlementId.slice(0, 8)}…</span>
                              {settlement?.proofUrl ? (
                                <WithdrawalProofLink url={settlement.proofUrl} id={settlement.id} />
                              ) : null}
                              {settlement?.confirmState === 'awaiting_confirmation' ? (
                                <Chip tone="warn">awaiting 2nd admin</Chip>
                              ) : null}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      ) : null}
                      {tab === 'requested' ? (
                        <td>
                          <span className="row gap wrap">
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={busyId === w.id}
                              title="Approve — creates the settlement (2nd-admin confirmation applies at/above the threshold)"
                              onClick={() => void doApprove(w)}
                            >
                              {busyId === w.id ? 'Working…' : '✔ Approve'}
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={busyId === w.id}
                              onClick={() => {
                                setRejectTarget(w);
                                setRejectNote('');
                              }}
                            >
                              Reject
                            </button>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rejectTarget ? (
        <Modal
          title={`Reject withdrawal of ${formatInr(rejectTarget.amountInr)}?`}
          onClose={() => setRejectTarget(null)}
        >
          <p className="muted small">
            {userLabel(rejectTarget)} will see this note in the app. Their balance is unaffected.
          </p>
          <label className="field">
            <span>Note (required)</span>
            <textarea
              rows={3}
              autoFocus
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="e.g. amount exceeds active balance / UPI verification failed"
            />
          </label>
          <div className="row gap end">
            <button className="btn btn-ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              disabled={busyId === rejectTarget.id || !rejectNote.trim()}
              onClick={() => void doReject()}
            >
              Reject withdrawal
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function WithdrawalProofLink({ url, id }: { url: string; id: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ext = url.split('.').pop()?.split('?')[0] || 'bin';
      const path = /^https?:\/\//i.test(url) ? url.replace(/^https?:\/\/[^/]+/i, '') : url;
      await downloadAuthedFile(path.startsWith('/') ? path : `/${path}`, `settlement-proof-${id}.${ext}`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row gap">
      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void download()}>
        {busy ? 'Downloading…' : '⇩ Proof'}
      </button>
      {err ? <span className="error-text small">{err}</span> : null}
    </span>
  );
}
