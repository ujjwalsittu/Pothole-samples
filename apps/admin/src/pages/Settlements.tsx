import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LedgerEntry, User } from '@pothole/shared';
import { SETTLEMENT_CONFIRM_THRESHOLD_INR } from '@pothole/shared';
import type { BalanceInfo, SettlementRow } from '../api/client';
import {
  cancelSettlement,
  confirmSettlement,
  createSettlement,
  downloadAuthedFile,
  errorMessage,
  getLedger,
  getUserBalance,
  listSettlements,
  listUsers,
} from '../api/client';
import { useMe } from '../auth/auth';
import {
  Avatar,
  Chip,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Modal,
  Spinner,
  formatDate,
  formatInr,
  stateTone,
} from '../components/ui';

interface UserWithBalance extends User {
  balance: BalanceInfo | null; // null while loading / unavailable
}

export function SettlementsPage() {
  const { me } = useMe();
  const [users, setUsers] = useState<UserWithBalance[] | null>(null);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [history, setHistory] = useState<SettlementRow[] | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [settleTarget, setSettleTarget] = useState<UserWithBalance | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsers(null);
    setUsersErr(null);
    (async () => {
      const approved = await listUsers('approved');
      const withBalances: UserWithBalance[] = await Promise.all(
        approved.map(async (u) => ({
          ...u,
          balance: await getUserBalance(u.id).catch(() => null),
        })),
      );
      withBalances.sort((a, b) => (b.balance?.balanceInr ?? 0) - (a.balance?.balanceInr ?? 0));
      return withBalances;
    })()
      .then((u) => {
        if (!cancelled) setUsers(u);
      })
      .catch((err) => {
        if (!cancelled) setUsersErr(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryErr(null);
    listSettlements()
      .then((rows) => {
        if (cancelled) return;
        setHistory(
          [...rows].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
        );
      })
      .catch((err) => {
        if (!cancelled) setHistoryErr(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const userById = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users ?? []) m.set(u.id, u);
    return m;
  }, [users]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const settlementUserLabel = (s: SettlementRow): string =>
    s.user?.fullName || s.userName || userById.get(s.userId)?.fullName || s.userEmail || s.userId;

  const awaiting = (history ?? []).filter((s) => s.confirmState === 'awaiting_confirmation');

  return (
    <div className="stack">
      {awaiting.length > 0 ? (
        <div className="card confirm-card">
          <h4 className="card-title">
            ⏳ Awaiting confirmation <Chip tone="warn">{awaiting.length}</Chip>
          </h4>
          <p className="muted small">
            Settlements of {formatInr(SETTLEMENT_CONFIRM_THRESHOLD_INR)} or more need a{' '}
            <strong>second admin</strong> to confirm — the initiating admin cannot confirm their own.
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Collector</th>
                  <th>Amount</th>
                  <th>UTR reference</th>
                  <th>Initiated by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((s) => (
                  <PendingConfirmRow
                    key={s.id}
                    row={s}
                    label={settlementUserLabel(s)}
                    meId={me.id}
                    onDone={refresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="card">
        <div className="row between">
          <h4 className="card-title">Payable balances</h4>
          <button className="btn btn-sm btn-ghost" onClick={refresh}>
            ↻ Refresh
          </button>
        </div>
        {usersErr ? (
          <ErrorState message={usersErr} onRetry={refresh} />
        ) : users === null ? (
          <LoadingPanel label="Loading balances…" />
        ) : users.length === 0 ? (
          <EmptyState title="No approved collectors yet" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Collector</th>
                  <th>UPI ID</th>
                  <th>Earned</th>
                  <th>Settled</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Avatar url={u.photoUrl} name={u.fullName} />
                    </td>
                    <td>
                      <strong>{u.fullName}</strong>
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td>{u.upiId || <span className="muted">— no UPI —</span>}</td>
                    <td>{u.balance ? formatInr(u.balance.earnedInr) : '—'}</td>
                    <td>{u.balance ? formatInr(u.balance.settledInr) : '—'}</td>
                    <td>
                      <strong className={u.balance && u.balance.balanceInr > 0 ? 'accent-text' : ''}>
                        {u.balance ? formatInr(u.balance.balanceInr) : '—'}
                      </strong>
                    </td>
                    <td>
                      <span className="row gap">
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={!u.balance || u.balance.balanceInr <= 0}
                          title={
                            !u.balance
                              ? 'Balance unavailable'
                              : u.balance.balanceInr <= 0
                                ? 'Nothing to settle'
                                : undefined
                          }
                          onClick={() => setSettleTarget(u)}
                        >
                          Settle
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setLedgerTarget(u)}>
                          Ledger
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h4 className="card-title">Settlement history</h4>
        {historyErr ? (
          <ErrorState message={historyErr} onRetry={refresh} />
        ) : history === null ? (
          <LoadingPanel label="Loading history…" />
        ) : history.length === 0 ? (
          <EmptyState title="No settlements yet" hint="Settled payouts appear here with UTR + proof." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Collector</th>
                  <th>Amount</th>
                  <th>State</th>
                  <th>UTR reference</th>
                  <th>Proof</th>
                  <th>Settled by</th>
                  <th>Confirmed by</th>
                  <th>Settled at</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{settlementUserLabel(s)}</strong>
                    </td>
                    <td>{formatInr(s.amountInr)}</td>
                    <td>
                      {s.confirmState === 'awaiting_confirmation' ? (
                        <Chip tone="warn">awaiting confirmation</Chip>
                      ) : s.confirmState === 'cancelled' ? (
                        <Chip tone="bad">cancelled</Chip>
                      ) : (
                        <Chip tone={stateTone(s.state)}>{s.state}</Chip>
                      )}
                    </td>
                    <td className="mono small">{s.utrReference || '—'}</td>
                    <td>
                      {s.proofUrl ? <ProofLink url={s.proofUrl} id={s.id} /> : <span className="muted">—</span>}
                    </td>
                    <td className="muted">{s.settledBy || s.initiatedByName || s.initiatedBy || '—'}</td>
                    <td className="muted">{s.confirmedByName || s.confirmedBy || '—'}</td>
                    <td className="muted">{formatDate(s.settledAt ?? s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {settleTarget ? (
        <SettleModal
          user={settleTarget}
          onClose={() => setSettleTarget(null)}
          onDone={() => {
            setSettleTarget(null);
            refresh();
          }}
        />
      ) : null}

      {ledgerTarget ? <LedgerDrawer user={ledgerTarget} onClose={() => setLedgerTarget(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PendingConfirmRow({
  row,
  label,
  meId,
  onDone,
}: {
  row: SettlementRow;
  label: string;
  meId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isInitiator = row.initiatedBy != null && row.initiatedBy === meId;

  const act = async (kind: 'confirm' | 'cancel') => {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === 'confirm') await confirmSettlement(row.id);
      else await cancelSettlement(row.id);
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <tr>
      <td>
        <strong>{label}</strong>
      </td>
      <td>
        <strong className="accent-text">{formatInr(row.amountInr)}</strong>
      </td>
      <td className="mono small">{row.utrReference || '—'}</td>
      <td className="muted">{row.initiatedByName || row.initiatedBy || '—'}</td>
      <td>
        <span className="row gap wrap">
          <button
            className="btn btn-sm btn-primary"
            disabled={busy !== null || isInitiator}
            title={
              isInitiator
                ? 'You initiated this settlement — a different admin must confirm it (two-admin rule).'
                : 'Confirm this settlement as the second admin'
            }
            onClick={() => void act('confirm')}
          >
            {busy === 'confirm' ? 'Confirming…' : '✔ Confirm'}
          </button>
          <button
            className="btn btn-sm btn-danger"
            disabled={busy !== null}
            onClick={() => void act('cancel')}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
          {err ? <span className="error-text small">⚠ {err}</span> : null}
        </span>
      </td>
    </tr>
  );
}

function ProofLink({ url, id }: { url: string; id: string }) {
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

function SettleModal({
  user,
  onClose,
  onDone,
}: {
  user: UserWithBalance;
  onClose: () => void;
  onDone: () => void;
}) {
  const balance = user.balance?.balanceInr ?? 0;
  const [amount, setAmount] = useState<string>(String(balance));
  const [utr, setUtr] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amountNum = Number(amount);
  const valid =
    Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balance && utr.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await createSettlement(user.id, {
        amountInr: amountNum,
        utrReference: utr.trim(),
        proof,
      });
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Settle ${user.fullName}`} onClose={onClose}>
      <div className="settle-summary">
        <div>
          <span className="muted small">UPI ID</span>
          <strong className="mono">{user.upiId || '— missing —'}</strong>
        </div>
        <div>
          <span className="muted small">Payable balance</span>
          <strong>{formatInr(balance)}</strong>
        </div>
      </div>
      <label className="field">
        <span>Amount (₹)</span>
        <input
          type="number"
          min={1}
          max={balance}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {Number.isFinite(amountNum) && amountNum > balance ? (
          <span className="error-text small">Cannot exceed the payable balance.</span>
        ) : null}
      </label>
      <label className="field">
        <span>UTR reference (required)</span>
        <input
          type="text"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          placeholder="e.g. 411234567890"
        />
      </label>
      <label className="field">
        <span>Payment proof (screenshot / PDF)</span>
        <input
          type="file"
          accept="image/*,.pdf"
          onChange={(e) => setProof(e.target.files?.[0] ?? null)}
        />
        {proof ? (
          <span className="muted small">
            {proof.name} ({(proof.size / 1024).toFixed(0)} KB)
          </span>
        ) : null}
      </label>
      {Number.isFinite(amountNum) && amountNum >= SETTLEMENT_CONFIRM_THRESHOLD_INR ? (
        <div className="notice">
          <span className="small">
            ⚠ {formatInr(amountNum)} is at/above the {formatInr(SETTLEMENT_CONFIRM_THRESHOLD_INR)}{' '}
            threshold — this settlement will wait for a <strong>second admin's confirmation</strong>{' '}
            before it is recorded as settled.
          </span>
        </div>
      ) : null}
      {err ? <p className="error-text">⚠ {err}</p> : null}
      <div className="row gap end">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? 'Recording settlement…' : `Settle ${Number.isFinite(amountNum) ? formatInr(amountNum) : ''}`}
        </button>
      </div>
    </Modal>
  );
}

function LedgerDrawer({ user, onClose }: { user: User; onClose: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLedger(user.id)
      .then((e) => {
        if (cancelled) return;
        setEntries(
          [...e].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        );
      })
      .catch((error) => {
        if (!cancelled) setErr(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <h3>Ledger — {user.fullName}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="drawer-body">
          {err ? (
            <ErrorState message={err} />
          ) : entries === null ? (
            <div className="state-panel">
              <Spinner />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              title="No ledger entries"
              hint="Earnings and settlements will appear here with a running balance."
            />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Note</th>
                    <th>Running balance</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{formatDate(e.createdAt)}</td>
                      <td>
                        <Chip tone={e.type === 'earning' ? 'good' : 'info'}>{e.type}</Chip>
                      </td>
                      <td className={e.amountInr >= 0 ? 'good-text' : 'bad-text'}>
                        {e.amountInr >= 0 ? '+' : ''}
                        {formatInr(e.amountInr)}
                      </td>
                      <td className="muted small">
                        {e.note || (e.sampleId ? `sample ${e.sampleId.slice(0, 8)}…` : '—')}
                      </td>
                      <td>
                        <strong>{formatInr(e.balanceInr)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
