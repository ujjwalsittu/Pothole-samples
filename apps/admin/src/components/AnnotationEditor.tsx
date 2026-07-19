import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Annotation, PolygonPoint } from '@pothole/shared';

/**
 * Editable annotation overlay, media-agnostic: renders `media` (an <img>
 * or <video>) inside a relatively-positioned frame and stretches an SVG
 * editing surface over it. Polygon coordinates are normalized [0..1];
 * the SVG viewBox tracks the rendered pixel size (ResizeObserver) so
 * handles stay round and strokes stay crisp at any size.
 *
 * Interactions (when editable):
 *  - click a polygon → select
 *  - drag a vertex handle → move vertex (commit on release)
 *  - click a hollow midpoint handle → insert a vertex there
 *  - double-click a vertex handle → delete it (min 3 kept)
 *  - draw mode: click to add vertices, double-click or Enter to close,
 *    Escape to cancel
 */

export interface AnnotationEditorProps {
  media: ReactNode;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  editable: boolean;
  drawing: boolean;
  onDrawComplete: (polygon: PolygonPoint[]) => void;
  onDrawCancel: () => void;
  /** Fires continuously while dragging (commit=false) and once on release (commit=true). */
  onPolygonChange: (id: string, polygon: PolygonPoint[], commit: boolean) => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function AnnotationEditor({
  media,
  annotations,
  selectedId,
  onSelect,
  editable,
  drawing,
  onDrawComplete,
  onDrawCancel,
  onPolygonChange,
}: AnnotationEditorProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [draft, setDraftState] = useState<PolygonPoint[]>([]);
  const draftRef = useRef<PolygonPoint[]>([]);
  const setDraft = useCallback((pts: PolygonPoint[]) => {
    draftRef.current = pts;
    setDraftState(pts);
  }, []);
  const [hoverPt, setHoverPt] = useState<PolygonPoint | null>(null);
  const dragRef = useRef<{ annId: string; vertexIdx: number; polygon: PolygonPoint[] } | null>(null);

  /* ---- track rendered size ---- */
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const px = useCallback((p: PolygonPoint) => ({ x: p.x * w, y: p.y * h }), [w, h]);

  const posFromEvent = useCallback(
    (e: { clientX: number; clientY: number }): PolygonPoint => {
      const r = frameRef.current?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
      return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    },
    [],
  );

  /* ---- draw mode ---- */
  useEffect(() => {
    if (!drawing) {
      setDraft([]);
      setHoverPt(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDrawCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const d = draftRef.current;
        if (d.length >= 3) onDrawComplete(d);
        else onDrawCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, onDrawComplete, onDrawCancel, setDraft]);

  const handleSurfaceClick = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!drawing) return;
      setDraft([...draftRef.current, posFromEvent(e)]);
    },
    [drawing, posFromEvent, setDraft],
  );

  const handleSurfaceDblClick = useCallback(() => {
    if (!drawing) return;
    const d = draftRef.current;
    // the dblclick also fired a click that added a duplicate point — drop it
    const pts = d.length >= 2 && dist(d[d.length - 1], d[d.length - 2]) < 0.005 ? d.slice(0, -1) : d;
    if (pts.length >= 3) onDrawComplete(pts);
    else onDrawCancel();
  }, [drawing, onDrawComplete, onDrawCancel]);

  /* ---- vertex dragging ---- */
  const startVertexDrag = useCallback(
    (e: ReactPointerEvent, ann: Annotation, vertexIdx: number) => {
      if (!editable || drawing) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect(ann.id);
      dragRef.current = { annId: ann.id, vertexIdx, polygon: [...ann.polygon] };
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [editable, drawing, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (drawing) {
        setHoverPt(posFromEvent(e));
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const p = posFromEvent(e);
      const next = drag.polygon.map((pt, i) => (i === drag.vertexIdx ? p : pt));
      drag.polygon = next;
      onPolygonChange(drag.annId, next, false);
    },
    [drawing, posFromEvent, onPolygonChange],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      try {
        svgRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      onPolygonChange(drag.annId, drag.polygon, true);
    },
    [onPolygonChange],
  );

  const insertVertex = useCallback(
    (ann: Annotation, afterIdx: number, at: PolygonPoint) => {
      const next = [...ann.polygon];
      next.splice(afterIdx + 1, 0, at);
      onPolygonChange(ann.id, next, true);
    },
    [onPolygonChange],
  );

  const deleteVertex = useCallback(
    (ann: Annotation, idx: number) => {
      if (ann.polygon.length <= 3) return;
      const next = ann.polygon.filter((_, i) => i !== idx);
      onPolygonChange(ann.id, next, true);
    },
    [onPolygonChange],
  );

  /* ---- render ---- */
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div ref={frameRef} className={`annot-frame${drawing ? ' drawing' : ''}`}>
      {media}
      <svg
        ref={svgRef}
        className="annot-overlay"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ pointerEvents: drawing ? 'all' : 'none' }}
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDblClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {annotations.map((a, i) => {
          if (!a.polygon || a.polygon.length < 3) return null;
          const pts = a.polygon.map((p) => `${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`).join(' ');
          const isSel = a.id === selectedId;
          const top = a.polygon.reduce(
            (best, p) => (p.y < best.y ? p : best),
            a.polygon[0],
          );
          return (
            <g key={a.id} className={`poly-group status-${a.status}${isSel ? ' selected' : ''}`}>
              <polygon
                points={pts}
                className="poly"
                style={{ pointerEvents: drawing ? 'none' : 'all', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(a.id);
                }}
              />
              <text x={px(top).x} y={Math.max(px(top).y - 6, 12)} className="poly-label" textAnchor="middle">
                {i + 1}. {a.label}
                {a.createdBy === 'admin' ? ' ★' : ''}
              </text>
            </g>
          );
        })}

        {/* vertex + midpoint handles for the selected annotation */}
        {editable && !drawing && selected && selected.polygon.length >= 3
          ? selected.polygon.map((p, idx) => {
              const q = selected.polygon[(idx + 1) % selected.polygon.length];
              const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
              return (
                <g key={idx}>
                  <circle
                    cx={px(mid).x}
                    cy={px(mid).y}
                    r={4.5}
                    className="handle handle-mid"
                    style={{ pointerEvents: 'all' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      insertVertex(selected, idx, mid);
                    }}
                  >
                    <title>Click to insert a vertex</title>
                  </circle>
                  <circle
                    cx={px(p).x}
                    cy={px(p).y}
                    r={6}
                    className="handle handle-vertex"
                    style={{ pointerEvents: 'all', cursor: 'grab' }}
                    onPointerDown={(e) => startVertexDrag(e, selected, idx)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      deleteVertex(selected, idx);
                    }}
                  >
                    <title>Drag to move · double-click to delete</title>
                  </circle>
                </g>
              );
            })
          : null}

        {/* in-progress draft polygon */}
        {drawing && draft.length > 0 ? (
          <g className="draft-group">
            <polyline
              points={[...draft, hoverPt ?? draft[draft.length - 1]]
                .map((p) => `${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`)
                .join(' ')}
              className="draft-line"
            />
            {draft.length >= 3 ? (
              <line
                x1={px(draft[draft.length - 1]).x}
                y1={px(draft[draft.length - 1]).y}
                x2={px(draft[0]).x}
                y2={px(draft[0]).y}
                className="draft-close"
              />
            ) : null}
            {draft.map((p, i) => (
              <circle key={i} cx={px(p).x} cy={px(p).y} r={i === 0 ? 6 : 4} className="handle handle-draft" />
            ))}
          </g>
        ) : null}
      </svg>
      {drawing ? (
        <div className="draw-hint">
          Click to add vertices · double-click or <kbd>Enter</kbd> to close ({draft.length} pts) ·{' '}
          <kbd>Esc</kbd> to cancel
        </div>
      ) : null}
    </div>
  );
}

function dist(a: PolygonPoint, b: PolygonPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
