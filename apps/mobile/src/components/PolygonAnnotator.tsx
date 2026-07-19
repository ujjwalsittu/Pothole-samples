/**
 * Reusable polygon annotator rendered over a photo or a paused video frame.
 *
 * - mode "polygon": tap to append a vertex to the ACTIVE polygon; tap near the
 *   first vertex (or use the parent's Close button) to close it; drag any
 *   vertex of the active polygon to adjust it. Multiple polygons supported.
 * - mode "reference": drag once across the visible road width to set the
 *   scale-reference line.
 * - mode "view": render-only.
 *
 * All coordinates are normalized [0..1] relative to the displayed image area
 * (width/height props), matching the shared PolygonPoint contract.
 */
import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import type { PolygonPoint } from '@/shared';

export interface AnnotatorPolygon {
  id: string;
  points: PolygonPoint[];
  closed: boolean;
  color: string;
}

export interface ReferenceLine {
  a: PolygonPoint;
  b: PolygonPoint;
}

interface Props {
  width: number;
  height: number;
  mode: 'polygon' | 'reference' | 'view';
  polygons: AnnotatorPolygon[];
  activePolygonId: string | null;
  referenceLine: ReferenceLine | null;
  onPolygonsChange: (polygons: AnnotatorPolygon[]) => void;
  onReferenceLineChange?: (line: ReferenceLine) => void;
}

const VERTEX_R = 8;
const TOUCH_SLOP = 6;
const GRAB_RADIUS = 22;

export function PolygonAnnotator({
  width,
  height,
  mode,
  polygons,
  activePolygonId,
  referenceLine,
  onPolygonsChange,
  onReferenceLineChange,
}: Props) {
  // Refs so the PanResponder (created once) always sees current values.
  const stateRef = useRef({ mode, polygons, activePolygonId, referenceLine, width, height });
  stateRef.current = { mode, polygons, activePolygonId, referenceLine, width, height };
  const changeRef = useRef({ onPolygonsChange, onReferenceLineChange });
  changeRef.current = { onPolygonsChange, onReferenceLineChange };

  const gestureRef = useRef<{
    kind: 'none' | 'dragVertex' | 'reference';
    polygonId?: string;
    vertexIndex?: number;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ kind: 'none', startX: 0, startY: 0, moved: false });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => stateRef.current.mode !== 'view',
        onMoveShouldSetPanResponder: () => stateRef.current.mode !== 'view',
        onPanResponderGrant: (evt) => {
          const s = stateRef.current;
          const { locationX, locationY } = evt.nativeEvent;
          gestureRef.current = { kind: 'none', startX: locationX, startY: locationY, moved: false };

          if (s.mode === 'reference') {
            gestureRef.current.kind = 'reference';
            const p = toNorm(locationX, locationY, s.width, s.height);
            changeRef.current.onReferenceLineChange?.({ a: p, b: p });
            return;
          }
          // polygon mode: grab a vertex of the active polygon if close enough
          const active = s.polygons.find((p) => p.id === s.activePolygonId);
          if (active) {
            for (let i = 0; i < active.points.length; i++) {
              const vx = active.points[i].x * s.width;
              const vy = active.points[i].y * s.height;
              if (Math.hypot(vx - locationX, vy - locationY) <= GRAB_RADIUS) {
                gestureRef.current.kind = 'dragVertex';
                gestureRef.current.polygonId = active.id;
                gestureRef.current.vertexIndex = i;
                return;
              }
            }
          }
        },
        onPanResponderMove: (evt) => {
          const s = stateRef.current;
          const g = gestureRef.current;
          const { locationX, locationY } = evt.nativeEvent;
          if (Math.hypot(locationX - g.startX, locationY - g.startY) > TOUCH_SLOP) g.moved = true;

          if (g.kind === 'reference' && s.referenceLine) {
            changeRef.current.onReferenceLineChange?.({
              a: s.referenceLine.a,
              b: toNorm(locationX, locationY, s.width, s.height),
            });
          } else if (g.kind === 'dragVertex' && g.polygonId != null && g.vertexIndex != null) {
            const next = s.polygons.map((p) =>
              p.id === g.polygonId
                ? {
                    ...p,
                    points: p.points.map((pt, i) =>
                      i === g.vertexIndex ? toNorm(locationX, locationY, s.width, s.height) : pt,
                    ),
                  }
                : p,
            );
            changeRef.current.onPolygonsChange(next);
          }
        },
        onPanResponderRelease: (evt) => {
          const s = stateRef.current;
          const g = gestureRef.current;
          if (s.mode !== 'polygon' || g.kind === 'reference') return;
          if (g.kind === 'dragVertex' || g.moved) return; // drag, not a tap

          const { locationX, locationY } = evt.nativeEvent;
          const active = s.polygons.find((p) => p.id === s.activePolygonId);
          if (!active || active.closed) return;

          // Tap near the FIRST vertex with >=3 points closes the polygon.
          if (active.points.length >= 3) {
            const fx = active.points[0].x * s.width;
            const fy = active.points[0].y * s.height;
            if (Math.hypot(fx - locationX, fy - locationY) <= GRAB_RADIUS) {
              changeRef.current.onPolygonsChange(
                s.polygons.map((p) => (p.id === active.id ? { ...p, closed: true } : p)),
              );
              return;
            }
          }
          // Otherwise append a vertex.
          const pt = toNorm(locationX, locationY, s.width, s.height);
          changeRef.current.onPolygonsChange(
            s.polygons.map((p) => (p.id === active.id ? { ...p, points: [...p.points, pt] } : p)),
          );
        },
      }),
    [],
  );

  return (
    <View style={[styles.wrap, { width, height }]} {...panResponder.panHandlers}>
      <Svg width={width} height={height} pointerEvents="none">
        {polygons.map((poly) => {
          const pts = poly.points.map((p) => `${p.x * width},${p.y * height}`).join(' ');
          const isActive = poly.id === activePolygonId;
          return (
            <React.Fragment key={poly.id}>
              {poly.closed ? (
                <Polygon
                  points={pts}
                  fill={`${poly.color}33`}
                  stroke={poly.color}
                  strokeWidth={isActive ? 3 : 2}
                />
              ) : (
                <Polyline
                  points={pts}
                  fill="none"
                  stroke={poly.color}
                  strokeWidth={isActive ? 3 : 2}
                  strokeDasharray="6 4"
                />
              )}
              {isActive &&
                poly.points.map((p, i) => (
                  <Circle
                    key={i}
                    cx={p.x * width}
                    cy={p.y * height}
                    r={i === 0 && !poly.closed ? VERTEX_R + 2 : VERTEX_R}
                    fill={i === 0 && !poly.closed ? poly.color : `${poly.color}CC`}
                    stroke="#0B1220"
                    strokeWidth={2}
                  />
                ))}
            </React.Fragment>
          );
        })}
        {referenceLine ? (
          <>
            <Line
              x1={referenceLine.a.x * width}
              y1={referenceLine.a.y * height}
              x2={referenceLine.b.x * width}
              y2={referenceLine.b.y * height}
              stroke="#38BDF8"
              strokeWidth={3}
              strokeDasharray="8 5"
            />
            <Circle cx={referenceLine.a.x * width} cy={referenceLine.a.y * height} r={6} fill="#38BDF8" />
            <Circle cx={referenceLine.b.x * width} cy={referenceLine.b.y * height} r={6} fill="#38BDF8" />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

function toNorm(x: number, y: number, width: number, height: number): PolygonPoint {
  return {
    x: Math.max(0, Math.min(1, x / width)),
    y: Math.max(0, Math.min(1, y / height)),
  };
}

/** Length of the reference line in normalized units (for ScaleReference). */
export function referenceLineLength(line: ReferenceLine): number {
  return Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0 },
});
