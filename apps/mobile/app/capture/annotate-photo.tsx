import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PolygonAnnotator,
  referenceLineLength,
  type AnnotatorPolygon,
  type ReferenceLine,
} from '@/components/PolygonAnnotator';
import { Button } from '@/components/Button';
import { CoachMark, useCoachMark } from '@/components/CoachMark';
import { clearCapture, getPhotoCapture, isOfflineMode } from '@/capture/session';
import { uploadManager } from '@/upload/manager';
import type { AnnotationUpload } from '@/api/endpoints';
import { ANNOTATION_COLORS, colors, font, radius, spacing } from '@/theme';
import {
  FILL_MATERIALS,
  POTHOLE_LABELS,
  ROAD_TYPES,
  estimatePothole,
  type PotholeEstimate,
  type Severity,
} from '@/shared';

/** Sensible default full-road widths (meters) by road type. */
const DEFAULT_ROAD_WIDTH: Record<string, number> = {
  asphalt: 3.5,
  concrete: 3.5,
  gravel: 3.0,
  'paver-block': 2.5,
  unpaved: 3.0,
};

interface PotholeShape extends AnnotatorPolygon {
  label: (typeof POTHOLE_LABELS)[number];
  severity: Severity;
  fillMaterial: keyof typeof FILL_MATERIALS;
}

type Step = 'reference' | 'annotate';

export default function AnnotatePhotoScreen() {
  const router = useRouter();
  const capture = getPhotoCapture();
  const { width: winW } = useWindowDimensions();

  const [step, setStep] = useState<Step>('reference');
  const [referenceLine, setReferenceLine] = useState<ReferenceLine | null>(null);
  const [roadType, setRoadType] = useState<(typeof ROAD_TYPES)[number]>('asphalt');
  const [roadWidthText, setRoadWidthText] = useState(String(DEFAULT_ROAD_WIDTH.asphalt));
  const [polys, setPolys] = useState<PotholeShape[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coach = useCoachMark('coach_annotator_v1');

  // Aspect-fit the photo into the available width (capped height).
  const display = useMemo(() => {
    if (!capture) return { w: winW, h: winW };
    const maxW = winW;
    const maxH = 420;
    const ratio = capture.height / Math.max(1, capture.width);
    let w = maxW;
    let h = w * ratio;
    if (h > maxH) {
      h = maxH;
      w = h / ratio;
    }
    return { w, h };
  }, [capture, winW]);

  if (!capture) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.missing}>No captured photo found.</Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} style={styles.missingBtn} />
      </SafeAreaView>
    );
  }

  const roadWidthM = parseFloat(roadWidthText) || 0;
  const refLen = referenceLine ? referenceLineLength(referenceLine) : 0;
  const scaleReady = refLen > 0.02 && roadWidthM > 0;

  const scale = {
    referenceLineNormalized: refLen,
    referenceMeters: roadWidthM,
    imageWidthPx: capture.width,
    imageHeightPx: capture.height,
  };

  const active = polys.find((p) => p.id === activeId) ?? null;

  const addPothole = () => {
    const id = `poly_${Date.now()}`;
    const color = ANNOTATION_COLORS[polys.length % ANNOTATION_COLORS.length];
    setPolys([
      ...polys,
      { id, points: [], closed: false, color, label: 'pothole', severity: 'medium', fillMaterial: 'hot-mix-asphalt' },
    ]);
    setActiveId(id);
  };

  const patchActive = (patch: Partial<PotholeShape>) => {
    if (!activeId) return;
    setPolys((prev) => prev.map((p) => (p.id === activeId ? { ...p, ...patch } : p)));
  };

  const undoVertex = () => {
    if (!active) return;
    if (active.closed) patchActive({ closed: false });
    else patchActive({ points: active.points.slice(0, -1) });
  };

  const closeActive = () => {
    if (active && active.points.length >= 3) patchActive({ closed: true });
  };

  const deleteActive = () => {
    if (!activeId) return;
    setPolys((prev) => prev.filter((p) => p.id !== activeId));
    setActiveId(null);
  };

  const estimateFor = (p: PotholeShape): PotholeEstimate | null => {
    if (!p.closed || p.points.length < 3 || !scaleReady) return null;
    return estimatePothole({
      polygon: p.points,
      scale,
      roadType,
      roadWidthM,
      severity: p.severity,
      fillMaterial: p.fillMaterial,
    });
  };

  const save = async () => {
    const closed = polys.filter((p) => p.closed && p.points.length >= 3);
    if (closed.length === 0) {
      setError('Draw and close at least one pothole polygon.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const annotations: AnnotationUpload[] = closed.map((p) => ({
        label: p.label,
        polygon: p.points,
        videoTimeSec: null,
        lat: capture.lat,
        lng: capture.lng,
        estimate: estimateFor(p),
      }));
      await uploadManager.createDraft({
        mediaType: 'photo',
        sourceUri: capture.photoUri,
        capturedAt: capture.capturedAt,
        lat: capture.lat,
        lng: capture.lng,
        gpsAccuracyM: capture.accuracyM,
        mockLocationDetected: capture.mocked,
        durationSec: null,
        avgSpeedKmph: null,
        maxSpeedKmph: null,
        track: null,
        annotations,
      });
      clearCapture();
      router.replace('/capture/queue');
    } catch (e) {
      // Surface specific messages (e.g. media size limit) from createDraft.
      setError(e instanceof Error && e.message ? e.message : 'Could not save the sample locally. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>
          {step === 'reference' ? 'Step 1 · Scale reference' : 'Step 2 · Mark potholes'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 'reference'
            ? 'Drag a line across the visible road width, then confirm the real width in meters.'
            : 'Tap to add polygon vertices around each pothole. Tap the first vertex (or Close) to finish a polygon. Drag vertices to adjust.'}
        </Text>
        {isOfflineMode() ? (
          <Text style={styles.offline}>OFFLINE MODE — this sample will be queued for upload.</Text>
        ) : null}

        {/* image + overlay */}
        <View style={[styles.imageWrap, { width: display.w, height: display.h }]}>
          <Image source={{ uri: capture.photoUri }} style={{ width: display.w, height: display.h }} />
          <PolygonAnnotator
            width={display.w}
            height={display.h}
            mode={step === 'reference' ? 'reference' : 'polygon'}
            polygons={polys}
            activePolygonId={activeId}
            referenceLine={referenceLine}
            onPolygonsChange={(next) =>
              setPolys((prev) =>
                next.map((n) => {
                  const old = prev.find((p) => p.id === n.id);
                  return { ...(old as PotholeShape), ...n };
                }),
              )
            }
            onReferenceLineChange={setReferenceLine}
          />
        </View>
        <Text style={styles.gpsLine}>
          GPS {capture.lat.toFixed(6)}, {capture.lng.toFixed(6)} (±{Math.round(capture.accuracyM)} m) —
          stored as metadata only, never drawn on the image.
        </Text>

        {step === 'reference' ? (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Road type</Text>
            <View style={styles.chipRow}>
              {ROAD_TYPES.map((rt) => (
                <Chip
                  key={rt}
                  label={rt}
                  active={roadType === rt}
                  onPress={() => {
                    setRoadType(rt);
                    setRoadWidthText(String(DEFAULT_ROAD_WIDTH[rt] ?? 3.5));
                  }}
                />
              ))}
            </View>
            <Text style={styles.panelLabel}>Real road width (meters)</Text>
            <TextInput
              style={styles.input}
              value={roadWidthText}
              onChangeText={setRoadWidthText}
              keyboardType="decimal-pad"
              placeholderTextColor={colors.textFaint}
            />
            {!referenceLine ? (
              <Text style={styles.hint}>Draw the line on the photo above (drag across the road).</Text>
            ) : null}
            <Button
              title="Next: mark potholes"
              onPress={() => setStep('annotate')}
              disabled={!scaleReady}
              style={styles.panelBtn}
            />
          </View>
        ) : (
          <View style={styles.panel}>
            <View style={styles.toolRow}>
              <Button title="+ Pothole" onPress={addPothole} style={styles.toolBtn} />
              <Button title="Undo" variant="secondary" onPress={undoVertex} disabled={!active} style={styles.toolBtn} />
              <Button
                title="Close"
                variant="secondary"
                onPress={closeActive}
                disabled={!active || active.closed || active.points.length < 3}
                style={styles.toolBtn}
              />
              <Button title="Delete" variant="danger" onPress={deleteActive} disabled={!active} style={styles.toolBtn} />
            </View>

            {active ? (
              <>
                <Text style={styles.panelLabel}>Label</Text>
                <View style={styles.chipRow}>
                  {POTHOLE_LABELS.map((l) => (
                    <Chip key={l} label={l} active={active.label === l} onPress={() => patchActive({ label: l })} />
                  ))}
                </View>
                <Text style={styles.panelLabel}>Severity (assumed depth)</Text>
                <View style={styles.chipRow}>
                  {(['shallow', 'medium', 'deep'] as const).map((s) => (
                    <Chip key={s} label={s} active={active.severity === s} onPress={() => patchActive({ severity: s })} />
                  ))}
                </View>
                <Text style={styles.panelLabel}>Fill material</Text>
                <View style={styles.chipRow}>
                  {(Object.keys(FILL_MATERIALS) as (keyof typeof FILL_MATERIALS)[]).map((m) => (
                    <Chip key={m} label={m} active={active.fillMaterial === m} onPress={() => patchActive({ fillMaterial: m })} />
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.hint}>Tap “+ Pothole” to start a polygon, then select it to edit.</Text>
            )}

            {/* estimates per closed pothole */}
            {polys
              .filter((p) => p.closed)
              .map((p, i) => {
                const est = estimateFor(p);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setActiveId(p.id)}
                    style={[styles.estCard, p.id === activeId && styles.estCardActive]}
                  >
                    <View style={styles.estHeader}>
                      <View style={[styles.estSwatch, { backgroundColor: p.color }]} />
                      <Text style={styles.estTitle}>
                        #{i + 1} {p.label} · {p.severity}
                      </Text>
                    </View>
                    {est ? (
                      <Text style={styles.estBody}>
                        ⌀ {est.diameterM ?? '—'} m · area {est.areaM2 ?? '—'} m² · vol{' '}
                        {est.volumeM3 ?? '—'} m³ · {est.materialKg ?? '—'} kg {p.fillMaterial}
                      </Text>
                    ) : (
                      <Text style={styles.estBody}>Estimates need the scale reference.</Text>
                    )}
                  </Pressable>
                );
              })}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              title={`Save sample (${polys.filter((p) => p.closed).length} pothole${polys.filter((p) => p.closed).length === 1 ? '' : 's'})`}
              onPress={() => void save()}
              loading={saving}
              style={styles.panelBtn}
            />
            <Button title="Back to scale" variant="ghost" onPress={() => setStep('reference')} />
          </View>
        )}
      </ScrollView>

      <CoachMark
        coach={coach}
        title="Annotating your photo"
        body="First drag a line across the visible road width and confirm the real width — that calibrates the size estimates. Then tap around each pothole to draw a polygon, close it, and pick a label."
      />
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
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
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  offline: {
    color: '#FCD34D',
    fontSize: font.tiny,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  imageWrap: { alignSelf: 'center', backgroundColor: '#000' },
  gpsLine: {
    color: colors.textFaint,
    fontSize: font.tiny,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  panel: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  panelLabel: { color: colors.textDim, fontSize: font.small, marginTop: spacing.md, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
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
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.body,
    width: 140,
  },
  hint: { color: colors.textFaint, fontSize: font.small, marginTop: spacing.sm },
  toolRow: { flexDirection: 'row', gap: spacing.xs },
  toolBtn: { flex: 1, minHeight: 40, paddingVertical: 8, paddingHorizontal: spacing.xs },
  estCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  estCardActive: { borderColor: colors.primary },
  estHeader: { flexDirection: 'row', alignItems: 'center' },
  estSwatch: { width: 12, height: 12, borderRadius: 3, marginRight: spacing.sm },
  estTitle: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  estBody: { color: colors.textDim, fontSize: font.tiny, marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: font.small, marginTop: spacing.md, textAlign: 'center' },
  panelBtn: { marginTop: spacing.md },
});
