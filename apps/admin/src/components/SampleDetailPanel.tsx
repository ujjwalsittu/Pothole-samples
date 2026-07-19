import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Annotation, PolygonPoint } from '@pothole/shared';
import {
  CONTENT_GUIDELINES,
  DEFAULT_PACKAGE,
  GPS_RULES,
  POTHOLE_LABELS,
  SPEED,
  VIDEO_RULES,
  coordinateAtVideoTime,
  hasMockedFix,
  trackSpeedsKmph,
} from '@pothole/shared';
import type { ReviewDecision, SampleDetail } from '../api/client';
import {
  createAnnotation,
  deleteAnnotation,
  errorMessage,
  fetchMediaBlob,
  getSampleDetail,
  patchAnnotation,
  reviewSample,
  sampleUserLabel,
} from '../api/client';
import { GpsTrackMap } from './GpsTrackMap';
import type { MapMarker } from './GpsTrackMap';
import { AnnotationEditor } from './AnnotationEditor';
import {
  Chip,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Spinner,
  annotationStatusTone,
  formatDate,
  formatDuration,
  formatInr,
  stateTone,
} from './ui';

const REJECT_REASONS = [
  { value: 'duplicate', label: 'Duplicate sample' },
  { value: 'too_short', label: 'Video too short' },
  { value: 'wrong_speed', label: 'Speed above the allowed maximum' },
  { value: 'off_road_content', label: 'Off-road content (trees/buildings/vehicles/people…)' },
  { value: 'bad_quality', label: 'Bad quality (blur / dark / shaky)' },
  { value: 'mock_location', label: 'Mock location detected' },
  { value: 'other', label: 'Other (describe below)' },
] as const;

/** How close (seconds) an annotation's videoTimeSec must be to the playhead to show on the frame. */
const VIDEO_ANNOTATION_WINDOW_SEC = 1;

/** ₹ credited when a sample is accepted: package payout split across the quota. */
export function creditForSample(mediaType: 'photo' | 'video'): number {
  const quota = mediaType === 'video' ? DEFAULT_PACKAGE.videoQuota : DEFAULT_PACKAGE.photoQuota;
  return Math.round((DEFAULT_PACKAGE.payoutInr / quota) * 100) / 100;
}

interface ChecklistItem {
  key: string;
  label: string;
  pass: boolean;
  detail?: string;
}

const isTempId = (id: string) => id.startsWith('temp-');

export function SampleDetailPanel({
  sampleId,
  readOnly,
  onDecided,
}: {
  sampleId: string;
  readOnly: boolean;
  /** Called after a successful review decision (review mode only). */
  onDecided?: (decision: ReviewDecision) => void;
}) {
  const [detail, setDetail] = useState<SampleDetail | null>(null);
  const [anns, setAnns] = useState<Annotation[]>([]);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedAnn, setSelectedAnn] = useState<string | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [drawing, setDrawing] = useState(false);
  const [drawLabel, setDrawLabel] = useState<string>(POTHOLE_LABELS[0]);
  const [annErr, setAnnErr] = useState<string | null>(null);

  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectPreset, setRejectPreset] = useState<string>('duplicate');
  const [rejectText, setRejectText] = useState('');
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  /* ---------------- load detail + media ---------------- */

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setAnns([]);
    setDetailErr(null);
    setMediaUrl(null);
    setMediaErr(null);
    setSelectedAnn(null);
    setVideoTime(0);
    setDrawing(false);
    setAnnErr(null);
    setManualChecks({});
    setRejectOpen(false);
    setRejectText('');
    setSubmitErr(null);

    getSampleDetail(sampleId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setAnns(d.annotations);
        }
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
  const track = detail?.gpsTrack ?? null;
  const isVideo = sample?.mediaType === 'video';

  /* ---------------- video sync ---------------- */

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v) setVideoTime(v.currentTime);
  }, []);

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

  /* ---------------- annotation editing (optimistic + rollback) ---------------- */

  const applyLocal = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnns((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const patchWithRollback = useCallback((id: string, patch: Partial<Annotation>) => {
    if (isTempId(id)) return; // creation still in flight
    setAnnErr(null);
    let snapshot: Annotation | undefined;
    setAnns((prev) => {
      snapshot = prev.find((a) => a.id === id);
      return prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
    });
    patchAnnotation(id, {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.polygon !== undefined ? { polygon: patch.polygon } : {}),
      ...(patch.videoTimeSec !== undefined && patch.videoTimeSec !== null
        ? { videoTimeSec: patch.videoTimeSec }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    }).catch((err) => {
      setAnnErr(`Saving annotation failed — change reverted (${errorMessage(err)})`);
      if (snapshot) {
        const prev = snapshot;
        setAnns((cur) => cur.map((a) => (a.id === id ? prev : a)));
      }
    });
  }, []);

  const onPolygonChange = useCallback(
    (id: string, polygon: PolygonPoint[], commit: boolean) => {
      if (!commit) applyLocal(id, { polygon });
      else patchWithRollback(id, { polygon });
    },
    [applyLocal, patchWithRollback],
  );

  const removeAnnotation = useCallback((ann: Annotation) => {
    setAnnErr(null);
    setSelectedAnn((sel) => (sel === ann.id ? null : sel));
    setAnns((prev) => prev.filter((a) => a.id !== ann.id));
    if (isTempId(ann.id)) return;
    deleteAnnotation(ann.id).catch((err) => {
      setAnnErr(`Deleting annotation failed — restored (${errorMessage(err)})`);
      setAnns((prev) => [...prev, ann]);
    });
  }, []);

  const completeDraw = useCallback(
    (polygon: PolygonPoint[]) => {
      if (!sample) return;
      setDrawing(false);
      setAnnErr(null);
      const videoTimeSec = isVideo ? Math.round(videoTime * 10) / 10 : null;
      const coord =
        isVideo && track && videoTimeSec != null
          ? coordinateAtVideoTime(track.points, track.recordingStartMs, videoTimeSec)
          : null;
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: Annotation = {
        id: tempId,
        sampleId: sample.id,
        label: drawLabel,
        status: 'accepted',
        createdBy: 'admin',
        polygon,
        videoTimeSec,
        lat: coord?.lat ?? sample.lat,
        lng: coord?.lng ?? sample.lng,
        estimate: null,
      };
      setAnns((prev) => [...prev, optimistic]);
      setSelectedAnn(tempId);
      createAnnotation(
        sample.id,
        {
          label: drawLabel,
          polygon,
          ...(videoTimeSec != null ? { videoTimeSec } : {}),
        },
        optimistic,
      )
        .then((saved) => {
          setAnns((prev) => prev.map((a) => (a.id === tempId ? saved : a)));
          setSelectedAnn((sel) => (sel === tempId ? saved.id : sel));
        })
        .catch((err) => {
          setAnnErr(`Creating annotation failed — removed (${errorMessage(err)})`);
          setAnns((prev) => prev.filter((a) => a.id !== tempId));
          setSelectedAnn((sel) => (sel === tempId ? null : sel));
        });
    },
    [sample, isVideo, videoTime, track, drawLabel],
  );

  const startDrawing = useCallback(() => {
    if (isVideo) videoRef.current?.pause();
    setSelectedAnn(null);
    setDrawing(true);
  }, [isVideo]);

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
        pass: (sample.durationSec ?? 0) >= VIDEO_RULES.MIN_DURATION_SECONDS,
        detail:
          sample.durationSec != null ? `${Math.round(sample.durationSec)}s recorded` : 'no duration reported',
      });
      const speedKnown = maxSpeed != null || avgSpeed != null;
      items.push({
        key: 'speed',
        label: `Max speed ≤ ${SPEED.MAX_KMPH} km/h`,
        pass: speedKnown && (maxSpeed ?? avgSpeed ?? Infinity) <= SPEED.MAX_KMPH,
        detail: speedKnown
          ? `avg ${avgSpeed != null ? avgSpeed.toFixed(1) : '?'} / max ${
              maxSpeed != null ? maxSpeed.toFixed(1) : '?'
            } km/h — no minimum`
          : 'no speed data',
      });
    }
    items.push({
      key: 'potholes',
      label: `≥ ${VIDEO_RULES.MIN_POTHOLES} potholes annotated`,
      pass: Math.max(sample.potholeCount ?? 0, anns.length) >= VIDEO_RULES.MIN_POTHOLES,
      detail: `${Math.max(sample.potholeCount ?? 0, anns.length)} annotated`,
    });
    items.push({
      key: 'gps',
      label: `GPS accuracy ≤ ${GPS_RULES.MAX_ACCURACY_METERS}m`,
      pass: sample.gpsAccuracyM <= GPS_RULES.MAX_ACCURACY_METERS,
      detail: `${sample.gpsAccuracyM.toFixed(1)}m at capture`,
    });
    items.push({
      key: 'mock',
      label: 'No mock location',
      pass: !sample.mockLocationDetected && !mockedInTrack,
      detail: sample.mockLocationDetected || mockedInTrack ? 'mocked fix detected' : 'clean',
    });
    return items;
  }, [sample, anns.length, avgSpeed, maxSpeed, mockedInTrack]);

  const manualItems = useMemo(
    () => CONTENT_GUIDELINES.avoid.map((a) => ({ key: a, label: `Not dominated by ${a}` })),
    [],
  );

  /* ---------------- review actions ---------------- */

  const decide = useCallback(
    async (decision: ReviewDecision, reason?: string) => {
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

  const editable = !readOnly;

  // For video: only annotations near the playhead show on the frame (±1 s window).
  const nearTime = (a: Annotation): boolean =>
    a.videoTimeSec == null || Math.abs(a.videoTimeSec - videoTime) <= VIDEO_ANNOTATION_WINDOW_SEC;
  const overlayAnns = isVideo ? anns.filter(nearTime) : anns;

  const markers: MapMarker[] =
    isVideo && track
      ? anns
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
  const acceptedCount = anns.filter((a) => a.status === 'accepted').length;
  const rejectedCount = anns.filter((a) => a.status === 'rejected').length;
  const canPartial = acceptedCount >= 1 && rejectedCount >= 1;

  const mediaEl = isVideo ? (
    <video
      ref={videoRef}
      src={mediaUrl ?? undefined}
      controls
      className="video-player"
      onTimeUpdate={onTimeUpdate}
    />
  ) : (
    <img src={mediaUrl ?? undefined} alt="Sample" className="photo-img" />
  );

  return (
    <div className="detail-panel">
      {/* header */}
      <div className="detail-head">
        <div className="row gap wrap">
          <Chip tone={sample.mediaType === 'video' ? 'info' : 'accent'}>{sample.mediaType}</Chip>
          <Chip tone={stateTone(sample.state)}>{sample.state.replace(/_/g, ' ')}</Chip>
          {sample.rejectionReason ? <Chip tone="bad">reason: {sample.rejectionReason}</Chip> : null}
        </div>
        <div className="muted small mt4">
          by <strong>{sampleUserLabel(sample)}</strong> · captured {formatDate(sample.capturedAt)} ·{' '}
          {sample.lat.toFixed(5)}, {sample.lng.toFixed(5)}
          {!isVideo ? (
            <>
              {' · '}
              <Link to={`/map?focus=${sample.lat.toFixed(6)},${sample.lng.toFixed(6)}`}>🗺 open in map</Link>
            </>
          ) : null}
        </div>
      </div>

      {/* media + annotation editor */}
      <div className="detail-media">
        {mediaErr ? (
          <ErrorState message={`Media unavailable: ${mediaErr}`} />
        ) : !mediaUrl ? (
          <div className="media-loading">
            <Spinner />
            <span className="muted small">Streaming media…</span>
          </div>
        ) : (
          <AnnotationEditor
            media={mediaEl}
            annotations={overlayAnns}
            selectedId={selectedAnn}
            onSelect={setSelectedAnn}
            editable={editable}
            drawing={drawing}
            onDrawComplete={completeDraw}
            onDrawCancel={() => setDrawing(false)}
            onPolygonChange={onPolygonChange}
          />
        )}
      </div>

      {/* editor toolbar */}
      {editable && mediaUrl && !mediaErr ? (
        <div className="card annot-toolbar">
          <div className="row gap wrap">
            <label className="field inline">
              <span>New label</span>
              <select value={drawLabel} onChange={(e) => setDrawLabel(e.target.value)}>
                {POTHOLE_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {drawing ? (
              <button className="btn btn-danger btn-sm" onClick={() => setDrawing(false)}>
                Cancel drawing
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={startDrawing}>
                {isVideo ? `✏ Add annotation at ${formatDuration(videoTime)}` : '✏ Draw new annotation'}
              </button>
            )}
            <span className="muted small">
              Select a polygon to edit: drag vertices · click a hollow midpoint to add one · double-click a
              vertex to delete it
              {isVideo ? ' · frame shows annotations within ±1 s of the playhead' : ''}
            </span>
          </div>
          {annErr ? <p className="error-text small">⚠ {annErr}</p> : null}
        </div>
      ) : annErr ? (
        <p className="error-text small">⚠ {annErr}</p>
      ) : null}

      {/* video-specific: GPS map + speed stats */}
      {isVideo ? (
        <div className="card">
          <div className="row between wrap gap">
            <h4 className="card-title">GPS track</h4>
            <Link
              className="btn btn-sm btn-ghost"
              to={`/map?focus=${sample.lat.toFixed(6)},${sample.lng.toFixed(6)}`}
            >
              🗺 Open in map
            </Link>
          </div>
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
                  <strong>{avgSpeed != null ? `${avgSpeed.toFixed(1)} km/h` : '—'}</strong>
                  <span className="muted small">no minimum required</span>
                </div>
                <div>
                  <span className="muted small">Max speed</span>
                  <strong
                    className={maxSpeed != null && maxSpeed > SPEED.MAX_KMPH ? 'bad-text' : 'good-text'}
                  >
                    {maxSpeed != null ? `${maxSpeed.toFixed(1)} km/h` : '—'}
                  </strong>
                  <span className="muted small">
                    max {SPEED.MAX_KMPH} (collectors are shown {SPEED.DISPLAYED_CAP_KMPH})
                  </span>
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
        <div className="row between wrap gap">
          <h4 className="card-title">Annotations ({anns.length})</h4>
          <span className="row gap">
            <Chip tone="good">{acceptedCount} accepted</Chip>
            <Chip tone="bad">{rejectedCount} rejected</Chip>
            <Chip tone="warn">{anns.length - acceptedCount - rejectedCount} pending</Chip>
          </span>
        </div>
        {anns.length === 0 ? (
          <EmptyState
            title="No annotations on this sample"
            hint={editable ? 'Use “Draw new annotation” above to add one as admin.' : undefined}
          />
        ) : (
          <ul className="ann-list">
            {anns.map((a, i) => {
              const temp = isTempId(a.id);
              const isNear = !isVideo || nearTime(a);
              return (
                <li
                  key={a.id}
                  className={`ann-row${a.id === selectedAnn ? ' selected' : ''}${isNear ? ' near' : ' far'}`}
                  onClick={() => {
                    setSelectedAnn(a.id);
                    if (isVideo) seekTo(a.videoTimeSec);
                  }}
                >
                  <span className="ann-index">{i + 1}</span>
                  {editable ? (
                    <select
                      value={a.label}
                      disabled={temp}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchWithRollback(a.id, { label: e.target.value })}
                    >
                      {(POTHOLE_LABELS as readonly string[]).includes(a.label) ? null : (
                        <option value={a.label}>{a.label}</option>
                      )}
                      {POTHOLE_LABELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Chip tone="accent">{a.label}</Chip>
                  )}
                  <Chip tone={a.createdBy === 'admin' ? 'info' : 'neutral'}>
                    {a.createdBy === 'admin' ? '★ admin' : 'collector'}
                  </Chip>
                  {editable ? (
                    <span className="status-toggle" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`toggle-chip good${a.status === 'accepted' ? ' on' : ''}`}
                        disabled={temp}
                        title="Accept this annotation"
                        onClick={() =>
                          patchWithRollback(a.id, {
                            status: a.status === 'accepted' ? 'pending' : 'accepted',
                          })
                        }
                      >
                        ✔ Accept
                      </button>
                      <button
                        className={`toggle-chip bad${a.status === 'rejected' ? ' on' : ''}`}
                        disabled={temp}
                        title="Reject this annotation"
                        onClick={() =>
                          patchWithRollback(a.id, {
                            status: a.status === 'rejected' ? 'pending' : 'rejected',
                          })
                        }
                      >
                        ✘ Reject
                      </button>
                    </span>
                  ) : null}
                  <Chip tone={annotationStatusTone(a.status)}>{a.status}</Chip>
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
                  {temp ? <Spinner small /> : null}
                  {editable ? (
                    <button
                      className="btn btn-sm btn-ghost ann-delete"
                      disabled={temp}
                      title="Delete annotation"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAnnotation(a);
                      }}
                    >
                      🗑
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {/* estimates table for photo annotations */}
        {!isVideo && anns.some((a) => a.estimate) ? (
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
                {anns.map((a, i) =>
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
                  onChange={(e) => setManualChecks((prev) => ({ ...prev, [item.key]: e.target.checked }))}
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
              title={
                manualAllChecked
                  ? 'Accept the sample and its annotations'
                  : 'Tip: complete the manual content checklist first'
              }
              onClick={() => void decide('accepted')}
            >
              {submitting === 'accepted' ? 'Accepting…' : `Accept all — credit ${formatInr(credit)}`}
            </button>
            <button
              className="btn btn-teal"
              disabled={submitting !== null || !canPartial}
              title={
                canPartial
                  ? `Accept the sample keeping only the ${acceptedCount} accepted annotation(s); the ${rejectedCount} rejected one(s) are dropped`
                  : 'Enabled when at least one annotation is accepted AND at least one is rejected — use the per-annotation Accept/Reject toggles above'
              }
              onClick={() => void decide('partially_accepted')}
            >
              {submitting === 'partially_accepted'
                ? 'Accepting…'
                : `Partially accept — credit ${formatInr(credit)}`}
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
