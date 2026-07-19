import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PackageInfo, User } from '@pothole/shared';
import {
  approveUser,
  createInvite,
  errorMessage,
  listInvites,
  listPackages,
  listUsers,
  patchUser,
  rejectUser,
  revokeInvite,
  type AdminInvite,
} from '../api/client';
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

const COLLECTOR_STATUSES = ['student', 'professional', 'self', 'owner'] as const;

function occupationLabel(s: string): string {
  return s === 'self' ? 'self-employed' : s;
}

function CollectorBadge({ user }: { user: User }) {
  return user.isCollector ? (
    <Chip tone="accent">★ collector</Chip>
  ) : (
    <span className="muted small">contributor</span>
  );
}

export function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('pending_approval');
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<User | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [collectorTarget, setCollectorTarget] = useState<User | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [packages, setPackages] = useState<PackageInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    listPackages()
      .then((p) => {
        if (!cancelled) setPackages(p);
      })
      .catch(() => undefined); // tolerate: hide package controls if unavailable
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
    async (
      u: User,
      patch: { collectorStatus?: string; role?: string; packageCode?: string; isCollector?: boolean },
    ) => {
      setBusyId(u.id);
      setActionErr(null);
      try {
        await patchUser(u.id, patch);
        refresh();
        return true;
      } catch (err) {
        setActionErr(errorMessage(err));
        return false;
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
          title={tab === 'pending_approval' ? 'No signups waiting for approval' : `No ${tab} users`}
          hint={tab === 'pending_approval' ? 'New signups will appear here.' : undefined}
        />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>User</th>
                  <th>Occupation</th>
                  <th>Contact</th>
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
                      <strong>{u.fullName}</strong> <CollectorBadge user={u} />
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td>
                      {tab === 'approved' ? (
                        <select
                          value={u.collectorStatus}
                          disabled={busyId === u.id}
                          onChange={(e) => void doPatch(u, { collectorStatus: e.target.value })}
                          title="Change occupation status — 'owner' is the admin-only promotion"
                        >
                          {COLLECTOR_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {occupationLabel(s)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Chip tone={u.collectorStatus === 'owner' ? 'accent' : 'neutral'}>
                          {occupationLabel(u.collectorStatus)}
                        </Chip>
                      )}
                      {u.organization ? <div className="muted small">{u.organization}</div> : null}
                    </td>
                    <td>
                      {u.mobile ? (
                        <span className="row gap">
                          <span className="mono small">{u.mobile}</span>
                          {u.whatsappAvailable ? <Chip tone="good">WhatsApp</Chip> : null}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted small">
                      {formatDate(u.createdAt)}
                      {u.signupLocation ? (
                        <div>
                          <Link
                            to={`/map?focus=${u.signupLocation.lat.toFixed(6)},${u.signupLocation.lng.toFixed(6)}`}
                          >
                            🗺 {u.signupLocation.lat.toFixed(4)}, {u.signupLocation.lng.toFixed(4)}
                          </Link>
                        </div>
                      ) : null}
                    </td>
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
                        {u.isCollector ? (
                          <select
                            value={u.packageCode}
                            disabled={busyId === u.id}
                            title="Assign collector plan"
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
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    ) : null}
                    <td>
                      <span className="row gap wrap">
                        <button className="btn btn-sm btn-ghost" onClick={() => setDetailUser(u)}>
                          Details
                        </button>
                        {tab === 'pending_approval' ? (
                          <>
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
                          </>
                        ) : tab === 'approved' ? (
                          u.isCollector ? (
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={busyId === u.id}
                              onClick={() => setCollectorTarget(u)}
                            >
                              Revoke collector
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={busyId === u.id}
                              onClick={() => setCollectorTarget(u)}
                            >
                              ★ Make collector
                            </button>
                          )
                        ) : (
                          <Chip tone={stateTone(u.accountState)}>{u.accountState.replace(/_/g, ' ')}</Chip>
                        )}
                      </span>
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
          <p className="muted small">The user will be told why their signup was rejected. This is required.</p>
          <label className="field">
            <span>Reason</span>
            <textarea
              rows={3}
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. duplicate account / incomplete profile"
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

      {collectorTarget ? (
        <CollectorModal
          user={collectorTarget}
          packages={packages}
          busy={busyId === collectorTarget.id}
          onClose={() => setCollectorTarget(null)}
          onConfirm={async (patch) => {
            const ok = await doPatch(collectorTarget, patch);
            if (ok) setCollectorTarget(null);
          }}
        />
      ) : null}

      {detailUser ? <UserDetailDrawer user={detailUser} onClose={() => setDetailUser(null)} /> : null}

      <AdminInvitesPanel />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Collector designation confirm modal                                 */
/* ------------------------------------------------------------------ */

function CollectorModal({
  user,
  packages,
  busy,
  onClose,
  onConfirm,
}: {
  user: User;
  packages: PackageInfo[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (patch: { isCollector: boolean; packageCode?: string }) => Promise<void>;
}) {
  const activePackages = packages.filter((p) => p.active);
  const [packageCode, setPackageCode] = useState(
    packages.some((p) => p.code === user.packageCode && p.active)
      ? user.packageCode
      : (activePackages[0]?.code ?? user.packageCode),
  );

  if (user.isCollector) {
    return (
      <Modal title={`Revoke collector status for ${user.fullName}?`} onClose={onClose}>
        <p className="muted small">
          They become a regular contributor: submissions stay welcome but accrue{' '}
          <strong>no further earnings</strong>. Existing balances are untouched.
        </p>
        <div className="row gap end">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void onConfirm({ isCollector: false })}>
            {busy ? 'Revoking…' : 'Revoke collector'}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Designate ${user.fullName} as paid collector?`} onClose={onClose}>
      <p className="muted small">
        Collectors accrue earnings on accepted samples (per completed track) and can request
        withdrawals. Regular contributors never see money in the app.
      </p>
      <label className="field">
        <span>Collector plan</span>
        {activePackages.length > 0 ? (
          <select value={packageCode} onChange={(e) => setPackageCode(e.target.value)}>
            {activePackages.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} — {p.videoQuota}v→₹{p.videoPayoutInr} / {p.photoQuota}p→₹{p.photoPayoutInr}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted small">
            No active packages available — the current code ({user.packageCode}) is kept.
          </span>
        )}
      </label>
      <div className="row gap end">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void onConfirm({
              isCollector: true,
              ...(activePackages.length > 0 ? { packageCode } : {}),
            })
          }
        >
          {busy ? 'Saving…' : `★ Make collector on ${activePackages.length > 0 ? packageCode : user.packageCode}`}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* User detail drawer                                                  */
/* ------------------------------------------------------------------ */

function UserDetailDrawer({ user, onClose }: { user: User; onClose: () => void }) {
  const [showFingerprint, setShowFingerprint] = useState(false);
  const hasFingerprint = !!user.deviceFingerprint && Object.keys(user.deviceFingerprint).length > 0;

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <h3>
            {user.fullName} <CollectorBadge user={user} />
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="drawer-body">
          <div className="detail-grid">
            <div>
              <span className="muted small">Email</span>
              <div>{user.email}</div>
            </div>
            <div>
              <span className="muted small">Account state</span>
              <div>
                <Chip tone={stateTone(user.accountState)}>{user.accountState.replace(/_/g, ' ')}</Chip>
              </div>
            </div>
            <div>
              <span className="muted small">Occupation</span>
              <div>
                {occupationLabel(user.collectorStatus)}
                {user.organization ? ` · ${user.organization}` : ''}
              </div>
            </div>
            <div>
              <span className="muted small">Role</span>
              <div>{user.role}</div>
            </div>
            <div>
              <span className="muted small">Mobile</span>
              <div className="row gap">
                <span className="mono">{user.mobile || '—'}</span>
                {user.whatsappAvailable ? <Chip tone="good">WhatsApp</Chip> : null}
              </div>
            </div>
            <div>
              <span className="muted small">UPI ID (set at first withdrawal)</span>
              <div className="mono">{user.upiId || '—'}</div>
            </div>
            <div>
              <span className="muted small">Package</span>
              <div className="mono">{user.packageCode}</div>
            </div>
            <div>
              <span className="muted small">Signed up</span>
              <div>{formatDate(user.createdAt)}</div>
            </div>
            <div>
              <span className="muted small">Approved</span>
              <div>{formatDate(user.approvedAt)}</div>
            </div>
            <div>
              <span className="muted small">Signup location</span>
              <div>
                {user.signupLocation ? (
                  <Link
                    to={`/map?focus=${user.signupLocation.lat.toFixed(6)},${user.signupLocation.lng.toFixed(6)}`}
                  >
                    🗺 {user.signupLocation.lat.toFixed(5)}, {user.signupLocation.lng.toFixed(5)} (±
                    {Math.round(user.signupLocation.acc)}m)
                  </Link>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>

          <div className="divider" />
          <div className="row between wrap gap">
            <strong>Device fingerprint</strong>
            {hasFingerprint ? (
              <button className="btn btn-sm btn-ghost" onClick={() => setShowFingerprint((s) => !s)}>
                {showFingerprint ? '▾ Hide' : '▸ Show'}
              </button>
            ) : (
              <span className="muted small">not captured</span>
            )}
          </div>
          {showFingerprint && hasFingerprint ? (
            <pre className="audit-detail">{JSON.stringify(user.deviceFingerprint, null, 2)}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Invite admins by email — applied instantly for existing accounts,
 * or automatically on that email's first login otherwise. */
function AdminInvitesPanel() {
  const [invites, setInvites] = useState<AdminInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listInvites()
      .then(setInvites)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const submit = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createInvite(email.trim(), role);
      setNotice(
        res.promotedExisting
          ? `${email.trim()} already has an account — promoted to ${role} immediately.`
          : `Invite sent to ${email.trim()} — ${role} access applies on their first login.`,
      );
      setShowModal(false);
      setEmail('');
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeInvite(id);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="card">
      <div className="row-between">
        <h3 className="card-title">Admin invites</h3>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + Invite admin
        </button>
      </div>
      <p className="muted small">
        Invitees log in to this dashboard with the invited email (Google sign-in works) and get
        admin access automatically — no signup needed.
      </p>
      {notice ? <p className="success-text">✔ {notice}</p> : null}
      {error ? <p className="error-text">⚠ {error}</p> : null}

      {invites && invites.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Invited by</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>
                    <Chip tone={i.role === 'owner' ? 'accent' : 'info'}>{i.role}</Chip>
                  </td>
                  <td>
                    <Chip tone={i.status === 'accepted' ? 'good' : i.status === 'revoked' ? 'bad' : 'warn'}>
                      {i.status}
                    </Chip>
                  </td>
                  <td>{i.inviterName ?? '—'}</td>
                  <td>{formatDate(i.createdAt)}</td>
                  <td>
                    {i.status === 'pending' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => void revoke(i.id)}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : invites ? (
        <p className="muted small">No invites yet.</p>
      ) : null}

      {showModal ? (
        <Modal title="Invite an admin" onClose={() => setShowModal(false)}>
          <label className="field-label">Email address</label>
          <input
            className="input"
            type="email"
            placeholder="teammate@threemates.tech"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <label className="field-label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'owner')}>
            <option value="admin">Admin — review, settle, manage</option>
            <option value="owner">Owner — full control (owners only can grant)</option>
          </select>
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Send invite'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
