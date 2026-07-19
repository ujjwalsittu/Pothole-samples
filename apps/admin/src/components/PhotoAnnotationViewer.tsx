import type { Annotation } from '@pothole/shared';

/**
 * Photo with annotation polygons drawn as an SVG overlay.
 * Polygon coordinates are normalized [0..1]; the SVG uses viewBox 0..1
 * with preserveAspectRatio="none" and is stretched over the rendered
 * image, so the polygons scale with it automatically.
 */
export function PhotoAnnotationViewer({
  src,
  annotations,
  selectedId,
  onSelect,
}: {
  src: string;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="photo-frame">
      <img src={src} alt="Sample" className="photo-img" />
      <svg className="photo-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
        {annotations.map((a, i) => {
          if (!a.polygon || a.polygon.length < 3) return null;
          const pts = a.polygon.map((p) => `${p.x},${p.y}`).join(' ');
          const selected = a.id === selectedId;
          const cx = a.polygon.reduce((s, p) => s + p.x, 0) / a.polygon.length;
          const cy = Math.min(...a.polygon.map((p) => p.y));
          return (
            <g key={a.id} onClick={() => onSelect(a.id)} className="poly-group">
              <polygon points={pts} className={selected ? 'poly selected' : 'poly'} vectorEffect="non-scaling-stroke" />
              <text x={cx} y={Math.max(cy - 0.015, 0.03)} className="poly-label" textAnchor="middle">
                {i + 1}. {a.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
