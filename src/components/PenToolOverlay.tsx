import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Layer, PathAnchor } from '../lib/api';

interface PenToolOverlayProps {
  /** Composition dimensions — drives the SVG viewBox so anchor coords map 1:1 to canvas pixels. */
  compositionWidth: number;
  compositionHeight: number;
  /** Called when the user finishes the path (Enter / Escape / Finish button). */
  onFinish: (layer: Layer) => void;
  /** Called when the user cancels without committing (no anchors yet, or explicit Cancel). */
  onCancel: () => void;
}

const generateId = () => `path-${Date.now().toString(36)}`;

/**
 * Pen-tool authoring overlay. Sits as an SVG on top of the preview canvas
 * when Pen Mode is active. Click empty canvas to drop an anchor; Enter
 * (or click Finish) commits the path as a new `type: 'path'` layer;
 * Escape (or click Cancel) discards.
 *
 * V1 emits polyline anchors only (no `in`/`out` handles). The renderer +
 * sampler already support Bezier-handle anchors, so the GUI for handle
 * authoring is a follow-up slice; today's authored polylines round-trip
 * through the schema with no rework needed when curves arrive.
 *
 * The overlay uses an SVG with viewBox = composition dimensions and
 * preserveAspectRatio="none", so SVG userspace coords ≡ canvas pixel
 * coords. Click handlers convert clientX/clientY → SVG userspace using
 * the same getBoundingClientRect math Edit Mode uses for hit-tests.
 */
export const PenToolOverlay: React.FC<PenToolOverlayProps> = ({
  compositionWidth,
  compositionHeight,
  onFinish,
  onCancel,
}) => {
  const [anchors, setAnchors] = useState<PathAnchor[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
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

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (!pt) return;
    setAnchors(prev => [...prev, { x: Math.round(pt.x), y: Math.round(pt.y) }]);
  }, [clientToUserspace]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (pt) setHover(pt);
  }, [clientToUserspace]);

  const finish = useCallback(() => {
    if (anchors.length < 2) {
      onCancel();
      return;
    }
    const layer: Layer = {
      id: generateId(),
      type: 'path',
      // path coords are absolute; position is informational / future "translate the whole path" handle.
      position: { x: 0, y: 0 },
      size: { width: compositionWidth, height: compositionHeight },
      properties: {
        anchors: anchors.map(a => ({ x: a.x, y: a.y })),
        closed: false,
        strokeColor: '#fbbf24',  // amber by default so it reads on most backgrounds
        strokeWidth: 2,
        showInPreview: true,
      },
    };
    onFinish(layer);
    setAnchors([]);
  }, [anchors, compositionWidth, compositionHeight, onFinish]);

  // Keyboard: Enter to finish, Escape to cancel, Backspace to undo last anchor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setAnchors([]);
        onCancel();
      } else if (e.key === 'Backspace' && anchors.length > 0) {
        e.preventDefault();
        setAnchors(prev => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchors.length, finish, onCancel]);

  // Build the polyline points for the in-progress path. Includes the
  // "preview" segment from the last anchor to the cursor so the user
  // sees where the next segment WOULD land.
  const polylinePoints = [
    ...anchors.map(a => `${a.x},${a.y}`),
    ...(hover && anchors.length > 0 ? [`${hover.x},${hover.y}`] : []),
  ].join(' ');

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${compositionWidth} ${compositionHeight}`}
        preserveAspectRatio="none"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: 'crosshair' }}
      >
        {/* In-progress path stroke */}
        {anchors.length >= 1 && polylinePoints && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray={anchors.length > 1 ? '0' : '6 4'}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Anchor dots */}
        {anchors.map((a, i) => (
          <circle
            key={i}
            cx={a.x}
            cy={a.y}
            r={6}
            fill={i === 0 ? '#22c55e' : '#fbbf24'}
            stroke="#0f172a"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Live cursor indicator */}
        {hover && (
          <circle
            cx={hover.x}
            cy={hover.y}
            r={4}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="4 2"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Floating instruction + action bar — positioned over the preview, doesn't intercept clicks except on its own buttons */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 shadow-2xl flex items-center gap-3">
          <span className="font-medium">Pen tool</span>
          <span className="text-slate-400">
            {anchors.length === 0 ? 'Click to start path'
              : anchors.length === 1 ? 'Click to add segments'
              : `${anchors.length} anchor${anchors.length === 1 ? '' : 's'}`}
            {' · Enter to finish · Esc to cancel · Backspace to undo'}
          </span>
        </div>
        <button
          onClick={finish}
          disabled={anchors.length < 2}
          className="pointer-events-auto px-3 py-1.5 text-xs font-medium rounded-lg transition bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-2xl"
        >
          Finish ({anchors.length})
        </button>
        <button
          onClick={() => { setAnchors([]); onCancel(); }}
          className="pointer-events-auto px-3 py-1.5 text-xs font-medium rounded-lg transition bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-2xl"
        >
          Cancel
        </button>
      </div>
    </>
  );
};
