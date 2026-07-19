import { useCallback, useEffect, useState } from 'react';
import type { PackageInfo, User } from '@pothole/shared';
import { approveUser, errorMessage, listPackages, listUsers, patchUser, rejectUser } from '../api/client';
import {
  Avatar,
  Chip,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Modal,
  formatDate,
  stateTone,
} from '../components/ui';

type Tab = 'pending_approval' | 'approved' | 'rejected';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_approval', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const COLLECTOR_STATUSES = ['student', 'professional', 'owner'] as const;

export function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('pending_approval');
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<User | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [packages, setPackages] = useState<PackageInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    listPackages()
      .then((p) => {
        if (!cancelled) setPackages(p);
      })
      .catch(() => undefined); // tolerate: hide the package column if unavailable
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUsers(null);
    setError(null);
    listUsers(tab)
      .then((u) => {
        if (!cancelled) setUsers(u);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const doApprove = useCallback(
    async (u: User) => {
      setBusyId(u.id);
      setActionErr(null);
      try {
        await approveUser(u.id);
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
    const reason = rejectReason.trim();
    if (!reason) {
      setActionErr('A rejection reason is required.');
      return;
    }
    setBusyId(rejectTarget.id);
    setActionErr(null);
    try {
      await rejectUser(rejectTarget.id, reason);
      setRejectTarget(null);
      setRejectReason('');
      refresh();
    } catch (err) {
      setActionErr(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }, [rejectTarget, rejectReason, refresh]);

  const doPatch = useCallback(
    async (u: User, patch: { collectorStatus?: string; role?: string; packageCode?: string }) => {
      setBusyId(u.id);
      setActionErr(null);
      try {
        await patchUser(u.id, patch);
        refresh();
      } catch (err) {
        setActionErr(errorMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="stack">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {actionErr ? <p className="error-text">⚠ {actionErr}</p> : null}

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : users === null ? (
        <LoadingPanel label="Loading users…" />
      ) : users.length === 0 ? (
        <EmptyState
          title={
            tab === 'pending_approval'
              ? 'No collectors waiting for approval'
              : `No ${tab} users`
          }
          hint={tab === 'pending_approval' ? 'New signups will appear here.' : undefined}
        />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>UPI ID</th>
                  <th>Signed up</th>
                  {tab === 'approved' ? <th>Role</th> : null}
                  {tab === 'approved' && packages.length > 0 ? <th>Package</th> : null}
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
                    </td>
                    <td className="muted">{u.email}</td>
                    <td>
                      {tab === 'approved' ? (
                        <select
                          value={u.collectorStatus}
                          disabled={busyId === u.id}
                          onChange={(e) => void doPatch(u, { collectorStatus: e.target.value })}
                          title="Change collector status — promoting to 'owner' is the admin-only action"
                        >
                          {COLLECTOR_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Chip tone={u.collectorStatus === 'owner' ? 'accent' : 'neutral'}>
                          {u.collectorStatus}
                        </Chip>
                      )}
                    </td>
                    <td>{u.upiId || <span className="muted">—</span>}</td>
                    <td className="muted">{formatDate(u.createdAt)}</td>
                    {tab === 'approved' ? (
                      <td>
                        {u.role === 'owner' ? (
                          <Chip tone="accent">owner</Chip>
                        ) : u.role === 'admin' ? (
                          <span className="row gap">
                            <Chip tone="info">admin</Chip>
                            <button
                              className="btn btn-sm btn-ghost"
                              disabled={busyId === u.id}
                              onClick={() => void doPatch(u, { role: 'collector' })}
                            >
                              Revoke
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm"
                            disabled={busyId === u.id}
                            onClick={() => void doPatch(u, { role: 'admin' })}
                          >
                            Promote to admin
                          </button>
                        )}
                      </td>
                    ) : null}
                    {tab === 'approved' && packages.length > 0 ? (
                      <td>
                        <select
                          value={u.packageCode}
                          disabled={busyId === u.id}
                          title="Assign earnings package"
                          onChange={(e) => void doPatch(u, { packageCode: e.target.value })}
                        >
                          {packages.some((p) => p.code === u.packageCode) ? null : (
                            <option value={u.packageCode}>{u.packageCode}</option>
                          )}
                          {packages.map((p) => (
                            <option key={p.code} value={p.code} disabled={!p.active}>
                              {p.code}
                              {p.active ? '' : ' (inactive)'}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td>
                      {tab === 'pending_approval' ? (
                        <span className="row gap">
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={busyId === u.id}
                            onClick={() => void doApprove(u)}
                          >
                            {busyId === u.id ? 'Working…' : 'Approve'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={busyId === u.id}
                            onClick={() => {
                              setRejectTarget(u);
                              setRejectReason('');
                            }}
                          >
                            Reject
                          </button>
                        </span>
                      ) : (
                        <Chip tone={stateTone(u.accountState)}>{u.accountState.replace('_', ' ')}</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rejectTarget ? (
        <Modal title={`Reject ${rejectTarget.fullName}?`} onClose={() => setRejectTarget(null)}>
          <p className="muted small">
            The collector will be told why their signup was rejected. This is required.
          </p>
          <label className="field">
            <span>Reason</span>
            <textarea
              rows={3}
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. UPI ID invalid / duplicate account / incomplete profile"
            />
          </label>
          <div className="row gap end">
            <button className="btn btn-ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              disabled={busyId === rejectTarget.id || !rejectReason.trim()}
              onClick={() => void doReject()}
            >
              Reject user
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
