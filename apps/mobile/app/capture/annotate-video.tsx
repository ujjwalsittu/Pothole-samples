import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { PolygonAnnotator, type AnnotatorPolygon } from '@/components/PolygonAnnotator';
import { Button } from '@/components/Button';
import { clearCapture, getVideoCapture, isOfflineMode } from '@/capture/session';
import { uploadManager } from '@/upload/manager';
import type { AnnotationUpload } from '@/api/endpoints';
import { ANNOTATION_COLORS, colors, font, radius, spacing } from '@/theme';
import {
  POTHOLE_LABELS,
  VIDEO_RULES,
  coordinateAtVideoTime,
  hasMockedFix,
  trackSpeedsKmph,
} from '@/shared';

interface VideoMark {
  id: string;
  videoTimeSec: number;
  label: (typeof POTHOLE_LABELS)[number];
  polygon: AnnotatorPolygon;
  lat: number;
  lng: number;
}

export default function AnnotateVideoScreen() {
  const router = useRouter();
  const capture = getVideoCapture();
  const { width: winW } = useWindowDimensions();

  const videoRef = useRef<Video>(null);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(capture?.durationSec ?? 0);
  const [playing, setPlaying] = useState(false);

  const [marks, setMarks] = useState<VideoMark[]>([]);
  const [draft, setDraft] = useState<{ timeSec: number; poly: AnnotatorPolygon; label: (typeof POTHOLE_LABELS)[number] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoH = Math.min(360, winW * 0.75);

  const speeds = useMemo(() => (capture ? trackSpeedsKmph(capture.track) : { avg: 0, max: 0 }), [capture]);

  if (!capture) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.missing}>No recorded video found.</Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} style={styles.missingBtn} />
      </SafeAreaView>
    );
  }

  const onStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionSec(status.positionMillis / 1000);
    if (status.durationMillis != null) setDurationSec(status.durationMillis / 1000);
    setPlaying(status.isPlaying);
  };

  const seekTo = (sec: number) => {
    const clamped = Math.max(0, Math.min(durationSec, sec));
    void videoRef.current?.setStatusAsync({ positionMillis: clamped * 1000, shouldPlay: false });
    setPositionSec(clamped);
  };

  const togglePlay = () => {
    if (draft) return; // locked while annotating a frame
    if (playing) void videoRef.current?.pauseAsync();
    else void videoRef.current?.playAsync();
  };

  const markHere = () => {
    void videoRef.current?.pauseAsync();
    const color = ANNOTATION_COLORS[marks.length % ANNOTATION_COLORS.length];
    setDraft({
      timeSec: positionSec,
      poly: { id: `mark_${Date.now()}`, points: [], closed: false, color },
      label: 'pothole',
    });
    setError(null);
  };

  const saveDraftMark = () => {
    if (!draft || !draft.poly.closed || draft.poly.points.length < 3) {
      setError('Draw and close a polygon around the pothole first.');
      return;
    }
    const coord = coordinateAtVideoTime(capture.track, capture.recordingStartMs, draft.timeSec);
    setMarks([
      ...marks,
      {
        id: draft.poly.id,
        videoTimeSec: Math.round(draft.timeSec * 100) / 100,
        label: draft.label,
        polygon: draft.poly,
        lat: coord?.lat ?? capture.track[0]?.lat ?? 0,
        lng: coord?.lng ?? capture.track[0]?.lng ?? 0,
      },
    ]);
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (marks.length < VIDEO_RULES.MIN_POTHOLES) {
      setError(`Videos need at least ${VIDEO_RULES.MIN_POTHOLES} marked potholes or they will be rejected.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const first = capture.track[0];
      const annotations: AnnotationUpload[] = marks.map((m) => ({
        label: m.label,
        polygon: m.polygon.points,
        videoTimeSec: m.videoTimeSec,
        lat: m.lat,
        lng: m.lng,
        estimate: null,
      }));
      await uploadManager.createDraft({
        mediaType: 'video',
        sourceUri: capture.videoUri,
        capturedAt: capture.capturedAt,
        lat: first?.lat ?? 0,
        lng: first?.lng ?? 0,
        gpsAccuracyM: first?.acc ?? 999,
        mockLocationDetected: hasMockedFix(capture.track),
        durationSec: Math.round(capture.durationSec * 10) / 10,
        avgSpeedKmph: Math.round(speeds.avg * 10) / 10,
        maxSpeedKmph: Math.round(speeds.max * 10) / 10,
        track: capture.track,
        recordingStartMs: capture.recordingStartMs,
        annotations,
      });
      clearCapture();
      router.replace('/capture/queue');
    } catch (e) {
      // Surface specific messages (e.g. the 1 GB video limit) from createDraft.
      setError(e instanceof Error && e.message ? e.message : 'Could not save the sample locally. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Mark potholes in your video</Text>
        <Text style={styles.subtitle}>
          Seek to each pothole moment, tap “Mark pothole here”, then draw a polygon on the paused
          frame. Coordinates are interpolated from your GPS track automatically.
        </Text>
        {isOfflineMode() ? (
          <Text style={styles.offline}>OFFLINE MODE — this sample will be queued for upload.</Text>
        ) : null}

        {/* player + overlay */}
        <View style={[styles.videoWrap, { width: winW, height: videoH }]}>
          <Video
            ref={videoRef}
            source={{ uri: capture.videoUri }}
            style={{ width: winW, height: videoH }}
            resizeMode={ResizeMode.CONTAIN}
            onPlaybackStatusUpdate={onStatus}
            progressUpdateIntervalMillis={200}
          />
          {draft ? (
            <PolygonAnnotator
              width={winW}
              height={videoH}
              mode="polygon"
              polygons={[draft.poly]}
              activePolygonId={draft.poly.id}
              referenceLine={null}
              onPolygonsChange={(next) => {
                const p = next.find((n) => n.id === draft.poly.id);
                if (p) setDraft({ ...draft, poly: p });
              }}
            />
          ) : null}
        </View>

        {/* scrubber */}
        <Scrubber
          positionSec={positionSec}
          durationSec={Math.max(0.1, durationSec)}
          disabled={draft != null}
          onSeek={seekTo}
        />
        <View style={styles.transportRow}>
          <Text style={styles.timeText}>
            {fmt(positionSec)} / {fmt(durationSec)}
          </Text>
          <View style={styles.transportBtns}>
            <SeekBtn label="-5s" onPress={() => seekTo(positionSec - 5)} disabled={draft != null} />
            <SeekBtn label="-1s" onPress={() => seekTo(positionSec - 1)} disabled={draft != null} />
            <Pressable style={styles.playBtn} onPress={togglePlay} disabled={draft != null}>
              <Text style={styles.playText}>{playing ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <SeekBtn label="+1s" onPress={() => seekTo(positionSec + 1)} disabled={draft != null} />
            <SeekBtn label="+5s" onPress={() => seekTo(positionSec + 5)} disabled={draft != null} />
          </View>
        </View>

        <View style={styles.panel}>
          {draft ? (
            <>
              <Text style={styles.panelTitle}>
                New pothole at {fmt(draft.timeSec)} — tap the frame to draw its outline
              </Text>
              <View style={styles.chipRow}>
                {POTHOLE_LABELS.map((l) => (
                  <Pressable
                    key={l}
                    onPress={() => setDraft({ ...draft, label: l })}
                    style={[styles.chip, draft.label === l && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, draft.label === l && styles.chipTextActive]}>{l}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.toolRow}>
                <Button
                  title="Undo"
                  variant="secondary"
                  onPress={() =>
                    setDraft({
                      ...draft,
                      poly: draft.poly.closed
                        ? { ...draft.poly, closed: false }
                        : { ...draft.poly, points: draft.poly.points.slice(0, -1) },
                    })
                  }
                  style={styles.toolBtn}
                />
                <Button
                  title="Close polygon"
                  variant="secondary"
                  disabled={draft.poly.closed || draft.poly.points.length < 3}
                  onPress={() => setDraft({ ...draft, poly: { ...draft.poly, closed: true } })}
                  style={styles.toolBtn}
                />
              </View>
              <View style={styles.toolRow}>
                <Button title="Save mark" onPress={saveDraftMark} style={styles.toolBtn} />
                <Button title="Discard" variant="danger" onPress={() => setDraft(null)} style={styles.toolBtn} />
              </View>
            </>
          ) : (
            <Button title="Mark pothole here" onPress={markHere} />
          )}

          {/* marked potholes with live interpolated coordinates */}
          <Text style={styles.panelTitle}>
            Marked potholes ({marks.length} / min {VIDEO_RULES.MIN_POTHOLES})
          </Text>
          {marks.length === 0 ? (
            <Text style={styles.hint}>
              None yet. Videos need at least {VIDEO_RULES.MIN_POTHOLES} marked potholes or they will
              be rejected.
            </Text>
          ) : (
            marks.map((m, i) => (
              <View key={m.id} style={styles.markRow}>
                <View style={[styles.markSwatch, { backgroundColor: m.polygon.color }]} />
                <View style={styles.markInfo}>
                  <Text style={styles.markTitle}>
                    #{i + 1} {m.label} @ {fmt(m.videoTimeSec)}
                  </Text>
                  <Text style={styles.markCoord}>
                    {m.lat.toFixed(6)}, {m.lng.toFixed(6)} (from GPS track)
                  </Text>
                </View>
                <Pressable onPress={() => setMarks(marks.filter((x) => x.id !== m.id))}>
                  <Text style={styles.markDelete}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}

          <View style={styles.statsRow}>
            <Text style={styles.statsText}>
              Duration {Math.round(capture.durationSec)}s · GPS points {capture.track.length}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title="Save sample"
            onPress={() => void save()}
            loading={saving}
            disabled={draft != null}
            style={styles.saveBtn}
          />
          <Button
            title="Discard recording"
            variant="ghost"
            onPress={() => {
              clearCapture();
              router.replace('/(tabs)/dashboard');
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SeekBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.seekBtn, disabled && styles.seekBtnDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.seekText}>{label}</Text>
    </Pressable>
  );
}

function Scrubber({
  positionSec,
  durationSec,
  disabled,
  onSeek,
}: {
  positionSec: number;
  durationSec: number;
  disabled: boolean;
  onSeek: (sec: number) => void;
}) {
  const widthRef = useRef(1);
  const stateRef = useRef({ durationSec, disabled, onSeek });
  stateRef.current = { durationSec, disabled, onSeek };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !stateRef.current.disabled,
        onMoveShouldSetPanResponder: () => !stateRef.current.disabled,
        onPanResponderGrant: (evt) => handle(evt.nativeEvent.locationX),
        onPanResponderMove: (evt) => handle(evt.nativeEvent.locationX),
      }),
    [],
  );

  function handle(x: number) {
    const frac = Math.max(0, Math.min(1, x / widthRef.current));
    stateRef.current.onSeek(frac * stateRef.current.durationSec);
  }

  const frac = Math.max(0, Math.min(1, positionSec / durationSec));
  return (
    <View
      style={[styles.scrubTrack, disabled && styles.scrubDisabled]}
      onLayout={(e) => {
        widthRef.current = Math.max(1, e.nativeEvent.layout.width);
      }}
      {...pan.panHandlers}
    >
      <View style={[styles.scrubFill, { width: `${frac * 100}%` }]} />
      <View style={[styles.scrubThumb, { left: `${frac * 100}%` }]} />
    </View>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  missing: { color: colors.textDim, fontSize: font.body, textAlign: 'center', marginTop: spacing.xxl },
  missingBtn: { margin: spacing.lg },
  scroll: { paddingBottom: spacing.xl },
  title: {
    color: colors.text,
    fontSize: font.h2,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: font.small,
    paddingHorizontal: spacing.md,
    marginVertical: spacing.sm,
  },
  offline: {
    color: '#FCD34D',
    fontSize: font.tiny,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  videoWrap: { backgroundColor: '#000' },
  scrubTrack: {
    height: 26,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    justifyContent: 'center',
    overflow: 'visible',
  },
  scrubDisabled: { opacity: 0.4 },
  scrubFill: {
    position: 'absolute',
    left: 0,
    top: 9,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  scrubThumb: {
    position: 'absolute',
    top: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  timeText: { color: colors.textDim, fontSize: font.small, fontVariant: ['tabular-nums'] },
  transportBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  seekBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  seekBtnDisabled: { opacity: 0.4 },
  seekText: { color: colors.text, fontSize: font.tiny, fontWeight: '600' },
  playBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  playText: { color: colors.onPrimary, fontSize: font.small, fontWeight: '700' },
  panel: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  panelTitle: { color: colors.text, fontSize: font.body, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: '#78350F' },
  chipText: { color: colors.textDim, fontSize: font.tiny, fontWeight: '600' },
  chipTextActive: { color: colors.primary },
  toolRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  toolBtn: { flex: 1, minHeight: 42, paddingVertical: 10 },
  hint: { color: colors.textFaint, fontSize: font.small },
  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  markSwatch: { width: 12, height: 12, borderRadius: 3, marginRight: spacing.sm },
  markInfo: { flex: 1 },
  markTitle: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  markCoord: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
  markDelete: { color: colors.danger, fontSize: font.small, fontWeight: '600' },
  statsRow: { marginTop: spacing.sm },
  statsText: { color: colors.textFaint, fontSize: font.tiny },
  error: { color: colors.danger, fontSize: font.small, marginTop: spacing.md, textAlign: 'center' },
  saveBtn: { marginTop: spacing.md },
});
