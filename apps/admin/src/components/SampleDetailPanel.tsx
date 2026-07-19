import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTENT_GUIDELINES,
  DEFAULT_PACKAGE,
  GPS_RULES,
  SPEED,
  VIDEO_RULES,
  coordinateAtVideoTime,
  hasMockedFix,
  trackSpeedsKmph,
} from '@pothole/shared';
import type { SampleDetail } from '../api/client';
import { errorMessage, fetchMediaBlob, getSampleDetail, reviewSample, sampleUserLabel } from '../api/client';
import { GpsTrackMap } from './GpsTrackMap';
import type { MapMarker } from './GpsTrackMap';
import { PhotoAnnotationViewer } from './PhotoAnnotationViewer';
import { Chip, EmptyState, ErrorState, LoadingPanel, Spinner, formatDate, formatDuration, formatInr, stateTone } from './ui';

const REJECT_REASONS = [
  { value: 'duplicate', label: 'Duplicate sample' },
  { value: 'too_short', label: 'Video too short' },
  { value: 'wrong_speed', label: 'Speed outside allowed window' },
  { value: 'off_road_content', label: 'Off-road content (trees/buildings/vehicles/people…)' },
  { value: 'bad_quality', label: 'Bad quality (blur / dark / shaky)' },
  { value: 'mock_location', label: 'Mock location detected' },
  { value: 'other', label: 'Other (describe below)' },
] as const;

/** ₹ credited when a sample is accepted: package payout split across the quota. */
export function creditForSample(mediaType: 'photo' | 'video'): number {
  const quota = mediaType === 'video' ? DEFAULT_PACKAGE.videoQuota : DEFAULT_PACKAGE.photoQuota;
  return Math.round((DEFAULT_PACKAGE.payoutInr / quota) * 100) / 100;
}

interface ChecklistItem {
  key: string;
  label: string;
  auto: boolean;
  pass?: boolean; // for auto items
  detail?: string;
}

export function SampleDetailPanel({
  sampleId,
  readOnly,
  onDecided,
}: {
  sampleId: string;
  readOnly: boolean;
  /** Called after a successful accept/reject (review mode only). */
  onDecided?: (decision: 'accepted' | 'rejected') => void;
}) {
  const [detail, setDetail] = useState<SampleDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedAnn, setSelectedAnn] = useState<string | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectPreset, setRejectPreset] = useState<string>('duplicate');
  const [rejectText, setRejectText] = useState('');
  const [submitting, setSubmitting] = useState<'accepted' | 'rejected' | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  /* ---------------- load detail + media ---------------- */

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailErr(null);
    setMediaUrl(null);
    setMediaErr(null);
    setSelectedAnn(null);
    setVideoTime(0);
    setManualChecks({});
    setRejectOpen(false);
    setRejectText('');
    setSubmitErr(null);

    getSampleDetail(sampleId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setDetailErr(errorMessage(err));
      });

    let objectUrl: string | null = null;
    fetchMediaBlob(sampleId)
      .then((url) => {
        objectUrl = url;
        if (!cancelled) setMediaUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch((err) => {
        if (!cancelled) setMediaErr(errorMessage(err));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sampleId, reloadKey]);

  const sample = detail?.sample ?? null;
  const annotations = detail?.annotations ?? [];
  const track = detail?.gpsTrack ?? null;
  const isVideo = sample?.mediaType === 'video';

  /* ---------------- video sync ---------------- */

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v) setVideoTime(v.currentTime);
  }, []);

  // Smooth dot movement while playing.
  useEffect(() => {
    if (!isVideo) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) setVideoTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isVideo, mediaUrl]);

  const cursor = useMemo(() => {
    if (!isVideo || !track || track.points.length === 0) return null;
    return coordinateAtVideoTime(track.points, track.recordingStartMs, videoTime);
  }, [isVideo, track, videoTime]);

  const seekTo = useCallback((sec: number | null) => {
    if (sec == null) return;
    const v = videoRef.current;
    if (v) {
      v.currentTime = sec;
      setVideoTime(sec);
    }
  }, []);

  /* ---------------- derived stats + checklist ---------------- */

  const speeds = useMemo(() => {
    if (!track || track.points.length < 2) return null;
    return trackSpeedsKmph(track.points);
  }, [track]);

  const avgSpeed = sample?.avgSpeedKmph ?? speeds?.avg ?? null;
  const maxSpeed = sample?.maxSpeedKmph ?? speeds?.max ?? null;
  const mockedInTrack = track ? hasMockedFix(track.points) : false;

  const autoChecklist = useMemo<ChecklistItem[]>(() => {
    if (!sample) return [];
    const items: ChecklistItem[] = [];
    if (sample.mediaType === 'video') {
      items.push({
        key: 'duration',
        label: `Duration ≥ ${VIDEO_RULES.MIN_DURATION_SECONDS}s`,
        auto: true,
        pass: (sample.durationSec ?? 0) >= VIDEO_RULES.MIN_DURATION_SECONDS,
        detail: sample.durationSec != null ? `${Math.round(sample.durationSec)}s recorded` : 'no duration reported',
      });
      items.push({
        key: 'speed',
        label: `Avg speed within ${SPEED.MIN_KMPH}–${SPEED.MAX_KMPH} km/h`,
        auto: true,
        pass:
          avgSpeed != null && avgSpeed >= SPEED.MIN_KMPH && avgSpeed <= SPEED.MAX_KMPH &&
          (maxSpeed == null || maxSpeed <= SPEED.MAX_KMPH),
        detail:
          avgSpeed != null
            ? `avg ${avgSpeed.toFixed(1)} / max ${maxSpeed != null ? maxSpeed.toFixed(1) : '?'} km/h`
            : 'no speed data',
      });
    }
    items.push({
      key: 'potholes',
      label: `≥ ${VIDEO_RULES.MIN_POTHOLES} potholes annotated`,
      auto: true,
      pass: Math.max(sample.potholeCount ?? 0, annotations.length) >= VIDEO_RULES.MIN_POTHOLES,
      detail: `${Math.max(sample.potholeCount ?? 0, annotations.length)} annotated`,
    });
    items.push({
      key: 'gps',
      label: `GPS accuracy ≤ ${GPS_RULES.MAX_ACCURACY_METERS}m`,
      auto: true,
      pass: sample.gpsAccuracyM <= GPS_RULES.MAX_ACCURACY_METERS,
      detail: `${sample.gpsAccuracyM.toFixed(1)}m at capture`,
    });
    items.push({
      key: 'mock',
      label: 'No mock location',
      auto: true,
      pass: !sample.mockLocationDetected && !mockedInTrack,
      detail: sample.mockLocationDetected || mockedInTrack ? 'mocked fix detected' : 'clean',
    });
    return items;
  }, [sample, annotations.length, avgSpeed, maxSpeed, mockedInTrack]);

  const manualItems = useMemo(
    () =>
      CONTENT_GUIDELINES.avoid.map((a) => ({
        key: a,
        label: `Not dominated by ${a}`,
      })),
    [],
  );

  /* ---------------- review actions ---------------- */

  const decide = useCallback(
    async (decision: 'accepted' | 'rejected', reason?: string) => {
      setSubmitting(decision);
      setSubmitErr(null);
      try {
        await reviewSample(sampleId, decision, reason);
        setRejectOpen(false);
        onDecided?.(decision);
      } catch (err) {
        setSubmitErr(errorMessage(err));
      } finally {
        setSubmitting(null);
      }
    },
    [sampleId, onDecided],
  );

  const submitReject = useCallback(() => {
    const preset = REJECT_REASONS.find((r) => r.value === rejectPreset);
    const text = rejectText.trim();
    if (rejectPreset === 'other' && !text) {
      setSubmitErr('A written reason is required for "Other".');
      return;
    }
    const reason =
      rejectPreset === 'other' ? text : text ? `${preset?.label}: ${text}` : preset?.label || rejectPreset;
    void decide('rejected', reason);
  }, [rejectPreset, rejectText, decide]);

  /* ---------------- render ---------------- */

  if (detailErr) {
    return <ErrorState message={detailErr} onRetry={() => setReloadKey((k) => k + 1)} />;
  }
  if (!sample) {
    return <LoadingPanel label="Loading sample…" />;
  }

  const selected = annotations.find((a) => a.id === selectedAnn) ?? null;
  const markers: MapMarker[] =
    isVideo && track
      ? annotations
          .map((a, i): MapMarker | null => {
            const c =
              a.videoTimeSec != null
                ? coordinateAtVideoTime(track.points, track.recordingStartMs, a.videoTimeSec)
                : { lat: a.lat, lng: a.lng };
            if (!c) return null;
            return { ...c, label: String(i + 1), highlighted: a.id === selectedAnn };
          })
          .filter((m): m is MapMarker => m !== null)
      : [];

  const credit = creditForSample(sample.mediaType);
  const manualAllChecked = manualItems.every((m) => manualChecks[m.key]);

  return (
    <div className="detail-panel">
      {/* header */}
      <div className="detail-head">
        <div>
          <div className="row gap wrap">
            <Chip tone={sample.mediaType === 'video' ? 'info' : 'accent'}>{sample.mediaType}</Chip>
            <Chip tone={stateTone(sample.state)}>{sample.state.replace('_', ' ')}</Chip>
            {sample.rejectionReason ? <Chip tone="bad">reason: {sample.rejectionReason}</Chip> : null}
          </div>
          <div className="muted small mt4">
            by <strong>{sampleUserLabel(sample)}</strong> · captured {formatDate(sample.capturedAt)} ·{' '}
            {sample.lat.toFixed(5)}, {sample.lng.toFixed(5)}
          </div>
        </div>
      </div>

      {/* media */}
      <div className="detail-media">
        {mediaErr ? (
          <ErrorState message={`Media unavailable: ${mediaErr}`} />
        ) : !mediaUrl ? (
          <div className="media-loading">
            <Spinner />
            <span className="muted small">Streaming media…</span>
          </div>
        ) : isVideo ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            controls
            className="video-player"
            onTimeUpdate={onTimeUpdate}
          />
        ) : (
          <PhotoAnnotationViewer
            src={mediaUrl}
            annotations={annotations}
            selectedId={selectedAnn}
            onSelect={setSelectedAnn}
          />
        )}
      </div>

      {/* video-specific: GPS map + speed stats */}
      {isVideo ? (
        <div className="card">
          <h4 className="card-title">GPS track</h4>
          {track && track.points.length > 0 ? (
            <>
              <GpsTrackMap points={track.points} cursor={cursor} markers={markers} />
              <div className="stat-strip">
                <div>
                  <span className="muted small">Duration</span>
                  <strong>{formatDuration(sample.durationSec)}</strong>
                  <span className="muted small">min {VIDEO_RULES.MIN_DURATION_SECONDS}s</span>
                </div>
                <div>
                  <span className="muted small">Avg speed</span>
                  <strong className={avgSpeed != null && (avgSpeed < SPEED.MIN_KMPH || avgSpeed > SPEED.MAX_KMPH) ? 'bad-text' : 'good-text'}>
                    {avgSpeed != null ? `${avgSpeed.toFixed(1)} km/h` : '—'}
                  </strong>
                  <span className="muted small">
                    allowed {SPEED.MIN_KMPH}–{SPEED.MAX_KMPH} (collector sees {SPEED.DISPLAYED_CAP_KMPH} only)
                  </span>
                </div>
                <div>
                  <span className="muted small">Max speed</span>
                  <strong className={maxSpeed != null && maxSpeed > SPEED.MAX_KMPH ? 'bad-text' : ''}>
                    {maxSpeed != null ? `${maxSpeed.toFixed(1)} km/h` : '—'}
                  </strong>
                  <span className="muted small">cap {SPEED.MAX_KMPH} km/h</span>
                </div>
                <div>
                  <span className="muted small">GPS points</span>
                  <strong>{track.points.length}</strong>
                  <span className="muted small">@{SPEED.GPS_SAMPLE_INTERVAL_MS / 1000}s interval</span>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="No GPS track" hint="This video sample has no recorded track." />
          )}
        </div>
      ) : null}

      {/* annotations */}
      <div className="card">
        <h4 className="card-title">Annotations ({annotations.length})</h4>
        {annotations.length === 0 ? (
          <EmptyState title="No annotations on this sample" />
        ) : (
          <ul className="ann-list">
            {annotations.map((a, i) => (
              <li
                key={a.id}
                className={`ann-row${a.id === selectedAnn ? ' selected' : ''}`}
                onClick={() => {
                  setSelectedAnn(a.id);
                  if (isVideo) seekTo(a.videoTimeSec);
                }}
              >
                <span className="ann-index">{i + 1}</span>
                <Chip tone="accent">{a.label}</Chip>
                {isVideo && a.videoTimeSec != null ? (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAnn(a.id);
                      seekTo(a.videoTimeSec);
                    }}
                  >
                    ▶ {formatDuration(a.videoTimeSec)}
                  </button>
                ) : null}
                <span className="muted small">
                  {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* estimates table for photo annotations */}
        {!isVideo && annotations.some((a) => a.estimate) ? (
          <div className="table-scroll mt8">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Label</th>
                  <th>Diameter (m)</th>
                  <th>Area (m²)</th>
                  <th>Volume (m³)</th>
                  <th>Material (kg)</th>
                  <th>Fill</th>
                  <th>Road</th>
                  <th>Road width (m)</th>
                </tr>
              </thead>
              <tbody>
                {annotations.map((a, i) =>
                  a.estimate ? (
                    <tr key={a.id} className={a.id === selectedAnn ? 'selected' : ''}>
                      <td>{i + 1}</td>
                      <td>{a.label}</td>
                      <td>{fmtNum(a.estimate.diameterM)}</td>
                      <td>{fmtNum(a.estimate.areaM2)}</td>
                      <td>{fmtNum(a.estimate.volumeM3)}</td>
                      <td>{fmtNum(a.estimate.materialKg)}</td>
                      <td>{a.estimate.fillMaterial}</td>
                      <td>{a.estimate.roadType}</td>
                      <td>{fmtNum(a.estimate.roadWidthM)}</td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        {selected && isVideo && track ? (
          <p className="muted small mt8">
            Selected pothole coordinate (interpolated from track):{' '}
            {(() => {
              const c =
                selected.videoTimeSec != null
                  ? coordinateAtVideoTime(track.points, track.recordingStartMs, selected.videoTimeSec)
                  : null;
              return c ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : `${selected.lat.toFixed(6)}, ${selected.lng.toFixed(6)}`;
            })()}
          </p>
        ) : null}
      </div>

      {/* validation checklist */}
      <div className="card">
        <h4 className="card-title">Validation checklist</h4>
        <ul className="checklist">
          {autoChecklist.map((item) => (
            <li key={item.key} className={item.pass ? 'check-pass' : 'check-fail'}>
              <span className="check-icon">{item.pass ? '✔' : '✘'}</span>
              <span>{item.label}</span>
              {item.detail ? <span className="muted small">({item.detail})</span> : null}
              <Chip tone="neutral">auto</Chip>
            </li>
          ))}
        </ul>
        <div className="divider" />
        <p className="muted small">Content check (manual) — frame must focus on the road surface:</p>
        <ul className="checklist">
          {manualItems.map((item) => (
            <li key={item.key}>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!manualChecks[item.key]}
                  disabled={readOnly}
                  onChange={(e) =>
                    setManualChecks((prev) => ({ ...prev, [item.key]: e.target.checked }))
                  }
                />
                <span>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {/* review actions */}
      {!readOnly ? (
        <div className="card review-actions">
          {submitErr ? <p className="error-text">⚠ {submitErr}</p> : null}
          <div className="row gap wrap">
            <button
              className="btn btn-primary"
              disabled={submitting !== null}
              title={manualAllChecked ? undefined : 'Tip: complete the manual content checklist first'}
              onClick={() => void decide('accepted')}
            >
              {submitting === 'accepted' ? 'Accepting…' : `Accept — credit ${formatInr(credit)}`}
            </button>
            <button
              className="btn btn-danger"
              disabled={submitting !== null}
              onClick={() => setRejectOpen((o) => !o)}
            >
              Reject…
            </button>
            {!manualAllChecked ? (
              <span className="muted small">Manual content checklist incomplete</span>
            ) : null}
          </div>

          {rejectOpen ? (
            <div className="reject-box">
              <label className="field">
                <span>Reason</span>
                <select value={rejectPreset} onChange={(e) => setRejectPreset(e.target.value)}>
                  {REJECT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Details {rejectPreset === 'other' ? '(required)' : '(optional)'}</span>
                <textarea
                  rows={2}
                  value={rejectText}
                  onChange={(e) => setRejectText(e.target.value)}
                  placeholder="Shown to the collector"
                />
              </label>
              <div className="row gap">
                <button className="btn btn-danger" disabled={submitting !== null} onClick={submitReject}>
                  {submitting === 'rejected' ? 'Rejecting…' : 'Confirm reject'}
                </button>
                <button className="btn btn-ghost" onClick={() => setRejectOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : sample.reviewedAt ? (
        <p className="muted small">
          Reviewed {formatDate(sample.reviewedAt)}
          {sample.reviewedBy ? ` by ${sample.reviewedBy}` : ''}
        </p>
      ) : null}
    </div>
  );
}

function fmtNum(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? String(n) : '—';
}
