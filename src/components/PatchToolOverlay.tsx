import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PathAnchor } from '../lib/api';

interface PatchToolOverlayProps {
  /** Composition dimensions — drive the SVG viewBox so coords map 1:1 to canvas pixels. */
  compositionWidth: number;
  compositionHeight: number;
  /**
   * Called when the patch is committed. `outline` is the closed region to repair
   * (corner anchors, composition-pixel coords). `source` is the offset VECTOR
   * (composition pixels) from the region to the clean texture to copy in — i.e.
   * `samplePoint - regionCentroid`. The caller converts both into the target
   * image layer's LOCAL 0..1 space before storing an ImagePatch.
   */
  onFinish: (patch: { outline: PathAnchor[]; source: { x: number; y: number } }) => void;
  /** Called when the user cancels without committing. */
  onCancel: () => void;
}

/**
 * Clone-stamp authoring overlay (A1) — two phases over the canvas:
 *
 *   1. DRAW: click to drop corner anchors around the blemish/tag (>= 3). The
 *      polygon closes implicitly. Enter / "Set source →" advances; Backspace
 *      undoes the last anchor; Esc cancels.
 *   2. SOURCE: the canvas image shows through this transparent overlay, so you
 *      click (or drag) onto a CLEAN part of the same image to copy from. A line
 *      runs from the region's centre to the sample point. Enter / "Apply patch"
 *      commits; Esc cancels.
 *
 * Corners only (no Bezier handles) — patch regions are small, so the simpler
 * interaction is enough. SVG userspace ≡ canvas pixels via viewBox +
 * preserveAspectRatio="none" (same convention as PenToolOverlay).
 */
export const PatchToolOverlay: React.FC<PatchToolOverlayProps> = ({
  compositionWidth,
  compositionHeight,
  onFinish,
  onCancel,
}) => {
  const [phase, setPhase] = useState<'draw' | 'source'>('draw');
  const [anchors, setAnchors] = useState<PathAnchor[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [sample, setSample] = useState<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const clientToUserspace = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (clientX - rect.left) * (compositionWidth / rect.width),
      y: (clientY - rect.top) * (compositionHeight / rect.height),
    };
  }, [compositionWidth, compositionHeight]);

  const centroid = useCallback((): { x: number; y: number } | null => {
    if (anchors.length === 0) return null;
    const sx = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
    const sy = anchors.reduce((s, a) => s + a.y, 0) / anchors.length;
    return { x: sx, y: sy };
  }, [anchors]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (!pt) return;
    if (phase === 'draw') {
      setAnchors(prev => [...prev, { x: Math.round(pt.x), y: Math.round(pt.y) }]);
    } else {
      draggingRef.current = true;
      setSample({ x: pt.x, y: pt.y });
    }
  }, [clientToUserspace, phase]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (!pt) return;
    setHover(pt);
    if (phase === 'source' && draggingRef.current) setSample({ x: pt.x, y: pt.y });
  }, [clientToUserspace, phase]);

  const handleMouseUp = useCallback(() => { draggingRef.current = false; }, []);

  const toSource = useCallback(() => {
    if (anchors.length < 3) return;
    // Default the sample point to the centroid (zero offset) so the SOURCE
    // phase starts neutral; the user then clicks the clean area to copy from.
    setSample(centroid());
    setPhase('source');
  }, [anchors.length, centroid]);

  const apply = useCallback(() => {
    const c = centroid();
    if (!c || anchors.length < 3 || !sample) return;
    onFinish({
      outline: anchors.map(a => ({ x: Math.round(a.x), y: Math.round(a.y) })),
      source: { x: Math.round(sample.x - c.x), y: Math.round(sample.y - c.y) },
    });
  }, [anchors, sample, centroid, onFinish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'draw') toSource(); else apply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Backspace' && phase === 'draw' && anchors.length > 0) {
        e.preventDefault();
        setAnchors(prev => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, anchors.length, toSource, apply, onCancel]);

  const polyPoints = anchors.map(a => `${a.x},${a.y}`).join(' ');
  const c = centroid();

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${compositionWidth} ${compositionHeight}`}
        preserveAspectRatio="none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHover(null); draggingRef.current = false; }}
        style={{ cursor: 'crosshair' }}
      >
        {/* Region outline */}
        {anchors.length >= 2 && (
          <polygon
            points={polyPoints}
            fill="rgba(56,189,248,0.18)"
            stroke="#38bdf8"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* Cursor preview while drawing — dashed segment from last anchor */}
        {phase === 'draw' && anchors.length > 0 && hover && (
          <line
            x1={anchors[anchors.length - 1].x} y1={anchors[anchors.length - 1].y}
            x2={hover.x} y2={hover.y}
            stroke="#38bdf8" strokeWidth={2} strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke" opacity={0.6}
          />
        )}
        {/* Region corner dots */}
        {anchors.map((a, i) => (
          <circle key={`a-${i}`} cx={a.x} cy={a.y} r={5}
            fill={i === 0 ? '#22c55e' : '#38bdf8'} stroke="#0f172a" strokeWidth={2}
            vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}

        {/* Source phase: line region-centre → sample point + crosshair */}
        {phase === 'source' && c && sample && (
          <>
            <line
              x1={c.x} y1={c.y} x2={sample.x} y2={sample.y}
              stroke="#34d399" strokeWidth={2} strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={c.x} cy={c.y} r={4} fill="#38bdf8" stroke="#0f172a"
              strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={sample.x} cy={sample.y} r={8} fill="rgba(52,211,153,0.4)"
              stroke="#34d399" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <line x1={sample.x - 11} y1={sample.y} x2={sample.x + 11} y2={sample.y}
              stroke="#34d399" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <line x1={sample.x} y1={sample.y - 11} x2={sample.x} y2={sample.y + 11}
              stroke="#34d399" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          </>
        )}
      </svg>

      {/* Floating instruction + action bar */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 shadow-2xl flex items-center gap-3">
          <span className="font-medium">Patch tool</span>
          <span className="text-slate-400">
            {phase === 'draw'
              ? (anchors.length === 0
                  ? 'Click around the mark you want to remove (3+ points)'
                  : `${anchors.length} point${anchors.length === 1 ? '' : 's'} · Enter to set source · Backspace to undo · Esc to cancel`)
              : 'Click a CLEAN area to copy from (drag to fine-tune) · Enter to apply · Esc to cancel'}
          </span>
        </div>
        {phase === 'draw' ? (
          <button
            onClick={toSource}
            disabled={anchors.length < 3}
            className="pointer-events-auto px-3 py-1.5 text-xs font-medium rounded-lg transition bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-2xl"
          >
            Set source → ({anchors.length})
          </button>
        ) : (
          <button
            onClick={apply}
            disabled={!sample}
            className="pointer-events-auto px-3 py-1.5 text-xs font-medium rounded-lg transition bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-2xl"
          >
            Apply patch
          </button>
        )}
        <button
          onClick={onCancel}
          className="pointer-events-auto px-3 py-1.5 text-xs font-medium rounded-lg transition bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-2xl"
        >
          Cancel
        </button>
      </div>
    </>
  );
};
