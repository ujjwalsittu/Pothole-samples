import { useCallback, useEffect, useState } from 'react';
import type { PackageInfo } from '@pothole/shared';
import type { PackageBody } from '../api/client';
import { createPackage, errorMessage, listPackages, updatePackage } from '../api/client';
import { Chip, EmptyState, ErrorState, LoadingPanel, Modal, formatInr } from '../components/ui';

export function PackagesPage() {
  const [packages, setPackages] = useState<PackageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<PackageInfo | 'new' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPackages(null);
    setError(null);
    listPackages()
      .then((p) => {
        if (!cancelled) setPackages(p);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <p className="muted small">
          Earnings packages — collectors complete either quota to earn the payout; a package can chain
          into a next one on completion.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + New package
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : packages === null ? (
        <LoadingPanel label="Loading packages…" />
      ) : packages.length === 0 ? (
        <EmptyState title="No packages configured" hint="Create one — new signups need a package to work toward." />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Video quota</th>
                  <th>Photo quota</th>
                  <th>Payout</th>
                  <th>Next package</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.code}>
                    <td className="mono small">{p.code}</td>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{p.videoQuota} videos</td>
                    <td>{p.photoQuota} photos</td>
                    <td>
                      <strong className="accent-text">{formatInr(p.payoutInr)}</strong>
                    </td>
                    <td className="mono small">{p.nextPackageCode || <span className="muted">— stop —</span>}</td>
                    <td>
                      <Chip tone={p.active ? 'good' : 'neutral'}>{p.active ? 'active' : 'inactive'}</Chip>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setEditing(p)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <PackageForm
          pkg={editing === 'new' ? null : editing}
          allCodes={(packages ?? []).map((p) => p.code)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PackageForm({
  pkg,
  allCodes,
  onClose,
  onSaved,
}: {
  pkg: PackageInfo | null;
  allCodes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(pkg?.code ?? '');
  const [name, setName] = useState(pkg?.name ?? '');
  const [videoQuota, setVideoQuota] = useState(String(pkg?.videoQuota ?? 10));
  const [photoQuota, setPhotoQuota] = useState(String(pkg?.photoQuota ?? 20));
  const [payoutInr, setPayoutInr] = useState(String(pkg?.payoutInr ?? 1000));
  const [active, setActive] = useState(pkg?.active ?? true);
  const [nextPackageCode, setNextPackageCode] = useState(pkg?.nextPackageCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nums = { videoQuota: Number(videoQuota), photoQuota: Number(photoQuota), payoutInr: Number(payoutInr) };
  const valid =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    Number.isFinite(nums.videoQuota) &&
    nums.videoQuota >= 0 &&
    Number.isFinite(nums.photoQuota) &&
    nums.photoQuota >= 0 &&
    Number.isFinite(nums.payoutInr) &&
    nums.payoutInr > 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const body: PackageBody = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      videoQuota: nums.videoQuota,
      photoQuota: nums.photoQuota,
      payoutInr: nums.payoutInr,
      active,
      nextPackageCode: nextPackageCode || null,
    };
    try {
      if (pkg) await updatePackage(pkg.code, body);
      else await createPackage(body);
      onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={pkg ? `Edit ${pkg.code}` : 'New package'} onClose={onClose}>
      <div className="form-grid">
        <label className="field">
          <span>Code</span>
          <input
            value={code}
            disabled={!!pkg}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. PRO_2500"
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pro Package" />
        </label>
        <label className="field">
          <span>Video quota</span>
          <input type="number" min={0} value={videoQuota} onChange={(e) => setVideoQuota(e.target.value)} />
        </label>
        <label className="field">
          <span>Photo quota</span>
          <input type="number" min={0} value={photoQuota} onChange={(e) => setPhotoQuota(e.target.value)} />
        </label>
        <label className="field">
          <span>Payout (₹)</span>
          <input type="number" min={1} value={payoutInr} onChange={(e) => setPayoutInr(e.target.value)} />
        </label>
        <label className="field">
          <span>Next package (on completion)</span>
          <select value={nextPackageCode} onChange={(e) => setNextPackageCode(e.target.value)}>
            <option value="">— stop after this —</option>
            {allCodes
              .filter((c) => c !== pkg?.code)
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
        </label>
        <label className="check-label">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active (assignable)</span>
        </label>
      </div>
      {err ? <p className="error-text">⚠ {err}</p> : null}
      <div className="row gap end mt8">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : pkg ? 'Save changes' : 'Create package'}
        </button>
      </div>
    </Modal>
  );
}
