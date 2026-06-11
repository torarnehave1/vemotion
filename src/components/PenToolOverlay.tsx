import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Layer, PathAnchor } from '../lib/api';

interface PenToolOverlayProps {
  /** Composition dimensions — drives the SVG viewBox so anchor coords map 1:1 to canvas pixels. */
  compositionWidth: number;
  compositionHeight: number;
  /**
   * 'path' (default) authors an open path layer (>= 2 anchors). 'mask' authors a
   * CLOSED clip outline (>= 3 anchors) for an image layer. The committed layer's
   * `properties.anchors` are still in composition-pixel coords either way; the
   * caller converts them to the image's local space in mask mode. The mode only
   * changes labels, the minimum anchor count, and the `closed` flag.
   */
  mode?: 'path' | 'mask';
  /** Called when the user finishes the path (Enter / Escape / Finish button). */
  onFinish: (layer: Layer) => void;
  /** Called when the user cancels without committing (no anchors yet, or explicit Cancel). */
  onCancel: () => void;
}

const generateId = () => `path-${Date.now().toString(36)}`;

/** Screen-pixel hit radius for grabbing anchors / handles (converted to SVG units at the call site). */
const HIT_RADIUS_SCREEN_PX = 10;
/** Minimum drag delta (SVG units) to flip "new anchor" from corner → smooth (avoids accidental tiny drags). */
const SMOOTH_DRAG_THRESHOLD = 4;

type Gesture =
  | { kind: 'idle' }
  | { kind: 'placing-new'; anchorIdx: number; anchorX: number; anchorY: number }
  | { kind: 'dragging-anchor'; anchorIdx: number; dx: number; dy: number }
  | { kind: 'dragging-handle'; anchorIdx: number; which: 'in' | 'out'; mirror: boolean };

/**
 * Pen-tool authoring overlay — Phase 2b (full Bezier handle authoring).
 *
 * Gestures:
 *   - Click on empty canvas → place a corner anchor.
 *   - Click + drag on empty canvas → place a smooth anchor; drag sets the
 *     outgoing handle. The incoming handle is set as the mirror of the
 *     outgoing one (smooth tangent — Illustrator default).
 *   - Click + drag an existing anchor → move it. Handles ride along.
 *   - Click + drag a handle endpoint → reshape that side of the curve.
 *     By default, dragging one handle mirrors the OTHER (smooth tangent
 *     preserved). Hold Alt while dragging to break the mirror — independent
 *     in / out handles for sharp curvature changes (Illustrator's "convert
 *     anchor point" behaviour).
 *   - Right-click an anchor → toggle smooth / corner. Smooth → strip
 *     handles. Corner → add symmetric handles tangent to the local segment.
 *
 * Keyboard:
 *   - Enter or Finish button → commit the path layer (+ auto-follower dot).
 *   - Escape or Cancel button → discard.
 *   - Backspace → undo last anchor.
 *
 * SVG userspace coords ≡ canvas pixel coords via viewBox + preserveAspectRatio="none".
 * Hit-test radius is screen-pixel-sized (converted on each gesture so it
 * stays clickable regardless of the canvas's display size).
 */
export const PenToolOverlay: React.FC<PenToolOverlayProps> = ({
  compositionWidth,
  compositionHeight,
  mode = 'path',
  onFinish,
  onCancel,
}) => {
  const [anchors, setAnchors] = useState<PathAnchor[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: 'idle' });
  const svgRef = useRef<SVGSVGElement>(null);
  // Live "alt-held" so the dragging-handle gesture knows whether to mirror.
  const altRef = useRef(false);
  // A mask must ENCLOSE area → needs >= 3 anchors and a closed outline; an
  // open path is usable with 2.
  const isMask = mode === 'mask';
  const minAnchors = isMask ? 3 : 2;

  // ── client ↔ SVG userspace coords + screen-px → SVG-units factor ───────────
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

  const hitRadiusSvg = useCallback((): number => {
    const svg = svgRef.current;
    if (!svg) return HIT_RADIUS_SCREEN_PX;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return HIT_RADIUS_SCREEN_PX;
    return HIT_RADIUS_SCREEN_PX * (compositionWidth / rect.width);
  }, [compositionWidth]);

  // ── Hit-test under cursor ──────────────────────────────────────────────────
  type Hit =
    | { kind: 'anchor'; anchorIdx: number }
    | { kind: 'handle'; anchorIdx: number; which: 'in' | 'out' }
    | { kind: 'empty' };

  const hitTest = useCallback((pt: { x: number; y: number }): Hit => {
    const r = hitRadiusSvg();
    const r2 = r * r;
    // Handles take priority over anchors (handle endpoints sit further from
    // the anchor centre and can otherwise be "behind" the anchor visually).
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.out) {
        const hx = a.x + a.out.x;
        const hy = a.y + a.out.y;
        const dx = pt.x - hx;
        const dy = pt.y - hy;
        if (dx * dx + dy * dy <= r2) return { kind: 'handle', anchorIdx: i, which: 'out' };
      }
      if (a.in) {
        const hx = a.x + a.in.x;
        const hy = a.y + a.in.y;
        const dx = pt.x - hx;
        const dy = pt.y - hy;
        if (dx * dx + dy * dy <= r2) return { kind: 'handle', anchorIdx: i, which: 'in' };
      }
    }
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const dx = pt.x - a.x;
      const dy = pt.y - a.y;
      if (dx * dx + dy * dy <= r2) return { kind: 'anchor', anchorIdx: i };
    }
    return { kind: 'empty' };
  }, [anchors, hitRadiusSvg]);

  // ── Mouse handlers (window-level during drag so off-canvas mouseups still fire) ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // left button only; right-click handled separately
    e.preventDefault();
    e.stopPropagation();
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (!pt) return;
    const hit = hitTest(pt);
    altRef.current = e.altKey;

    if (hit.kind === 'anchor') {
      setGesture({
        kind: 'dragging-anchor',
        anchorIdx: hit.anchorIdx,
        dx: pt.x - anchors[hit.anchorIdx].x,
        dy: pt.y - anchors[hit.anchorIdx].y,
      });
      return;
    }
    if (hit.kind === 'handle') {
      setGesture({
        kind: 'dragging-handle',
        anchorIdx: hit.anchorIdx,
        which: hit.which,
        mirror: !e.altKey,
      });
      return;
    }
    // Empty → place a NEW anchor. Starts as a corner; if the user drags
    // before mouseup, it upgrades to smooth (out + mirrored in).
    setAnchors(prev => {
      const next = [...prev, { x: Math.round(pt.x), y: Math.round(pt.y) }];
      setGesture({
        kind: 'placing-new',
        anchorIdx: next.length - 1,
        anchorX: pt.x,
        anchorY: pt.y,
      });
      return next;
    });
  }, [anchors, clientToUserspace, hitTest]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (pt) setHover(pt);
    if (gesture.kind === 'idle') return;
    if (!pt) return;

    if (gesture.kind === 'placing-new') {
      const dx = pt.x - gesture.anchorX;
      const dy = pt.y - gesture.anchorY;
      const dist = Math.hypot(dx, dy);
      setAnchors(prev => prev.map((a, i) => {
        if (i !== gesture.anchorIdx) return a;
        if (dist < SMOOTH_DRAG_THRESHOLD) {
          // Below threshold — keep as corner. Strip any partial handles.
          const { in: _in, out: _out, ...rest } = a;
          void _in; void _out;
          return { ...rest, x: gesture.anchorX, y: gesture.anchorY };
        }
        return {
          x: gesture.anchorX,
          y: gesture.anchorY,
          out: { x: dx, y: dy },
          in:  { x: -dx, y: -dy }, // smooth tangent — mirror
        };
      }));
      return;
    }

    if (gesture.kind === 'dragging-anchor') {
      const newX = pt.x - gesture.dx;
      const newY = pt.y - gesture.dy;
      setAnchors(prev => prev.map((a, i) => i === gesture.anchorIdx ? { ...a, x: newX, y: newY } : a));
      return;
    }

    if (gesture.kind === 'dragging-handle') {
      const offsetX = pt.x - anchors[gesture.anchorIdx].x;
      const offsetY = pt.y - anchors[gesture.anchorIdx].y;
      // Alt held? Pull free (break mirror) for this single drag.
      const mirror = gesture.mirror && !e.altKey;
      setAnchors(prev => prev.map((a, i) => {
        if (i !== gesture.anchorIdx) return a;
        const next = { ...a };
        if (gesture.which === 'out') {
          next.out = { x: offsetX, y: offsetY };
          if (mirror) next.in = { x: -offsetX, y: -offsetY };
        } else {
          next.in = { x: offsetX, y: offsetY };
          if (mirror) next.out = { x: -offsetX, y: -offsetY };
        }
        return next;
      }));
      return;
    }
  }, [anchors, clientToUserspace, gesture]);

  const handleMouseUp = useCallback(() => {
    setGesture({ kind: 'idle' });
  }, []);

  // Right-click toggles smooth / corner on an existing anchor.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (!pt) return;
    const hit = hitTest(pt);
    if (hit.kind !== 'anchor') return;
    setAnchors(prev => prev.map((a, i) => {
      if (i !== hit.anchorIdx) return a;
      if (a.in || a.out) {
        // Smooth → corner (strip handles)
        const { in: _in, out: _out, ...rest } = a;
        void _in; void _out;
        return rest;
      }
      // Corner → smooth (add symmetric handles tangent to local segment).
      // Direction inferred from the surrounding anchors; falls back to
      // horizontal if endpoints.
      const prevA = prev[i - 1];
      const nextA = prev[i + 1];
      let tx = 1, ty = 0;
      if (prevA && nextA) {
        tx = nextA.x - prevA.x;
        ty = nextA.y - prevA.y;
      } else if (prevA) {
        tx = a.x - prevA.x;
        ty = a.y - prevA.y;
      } else if (nextA) {
        tx = nextA.x - a.x;
        ty = nextA.y - a.y;
      }
      const len = Math.hypot(tx, ty) || 1;
      // Handle reach = 25% of the local segment length (looks natural).
      const reach = (len * 0.25) || 40;
      const ux = (tx / len) * reach;
      const uy = (ty / len) * reach;
      return { ...a, in: { x: -ux, y: -uy }, out: { x: ux, y: uy } };
    }));
  }, [clientToUserspace, hitTest]);

  // ── Finish + cancel + undo ─────────────────────────────────────────────────
  const finish = useCallback(() => {
    if (anchors.length < minAnchors) {
      onCancel();
      return;
    }
    const layer: Layer = {
      id: generateId(),
      type: 'path',
      position: { x: 0, y: 0 },
      size: { width: compositionWidth, height: compositionHeight },
      properties: {
        anchors: anchors.map(a => ({
          x: Math.round(a.x),
          y: Math.round(a.y),
          ...(a.in  ? { in:  { x: Math.round(a.in.x),  y: Math.round(a.in.y)  } } : {}),
          ...(a.out ? { out: { x: Math.round(a.out.x), y: Math.round(a.out.y) } } : {}),
        })),
        closed: isMask,
        strokeColor: '#fbbf24',
        strokeWidth: 2,
        showInPreview: true,
      },
    };
    onFinish(layer);
    setAnchors([]);
  }, [anchors, compositionWidth, compositionHeight, onFinish, minAnchors, isMask]);

  // Keyboard: Enter / Esc / Backspace.
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

  // ── Render the in-progress path (with Bezier segments when handles exist) ─
  const pathD = (() => {
    if (anchors.length === 0) return '';
    let d = `M ${anchors[0].x},${anchors[0].y}`;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      // Match renderer.drawPath + pathSampling: EITHER handle counts;
      // missing side falls back to the anchor position itself.
      if (a.out || b.in) {
        const c1x = a.out ? a.x + a.out.x : a.x;
        const c1y = a.out ? a.y + a.out.y : a.y;
        const c2x = b.in  ? b.x + b.in.x  : b.x;
        const c2y = b.in  ? b.y + b.in.y  : b.y;
        d += ` C ${c1x},${c1y} ${c2x},${c2y} ${b.x},${b.y}`;
      } else {
        d += ` L ${b.x},${b.y}`;
      }
    }
    return d;
  })();

  // Cursor-preview segment from last anchor to mouse position.
  const lastA = anchors[anchors.length - 1];
  const cursorPreview = (gesture.kind === 'idle' && lastA && hover)
    ? `M ${lastA.x},${lastA.y} L ${hover.x},${hover.y}`
    : '';

  const cursor =
    gesture.kind === 'dragging-anchor' || gesture.kind === 'dragging-handle' ? 'grabbing'
    : gesture.kind === 'placing-new' ? 'grabbing'
    : 'crosshair';

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
        onMouseLeave={() => { setHover(null); }}
        onContextMenu={handleContextMenu}
        style={{ cursor }}
      >
        {/* Committed-so-far path */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Cursor preview — dashed segment from last anchor to mouse pos */}
        {cursorPreview && (
          <path
            d={cursorPreview}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            opacity={0.6}
          />
        )}

        {/* Handle lines (anchor centre → handle endpoint) */}
        {anchors.map((a, i) => (
          <React.Fragment key={`h-${i}`}>
            {a.in && (
              <line
                x1={a.x} y1={a.y}
                x2={a.x + a.in.x} y2={a.y + a.in.y}
                stroke="#94a3b8"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {a.out && (
              <line
                x1={a.x} y1={a.y}
                x2={a.x + a.out.x} y2={a.y + a.out.y}
                stroke="#94a3b8"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </React.Fragment>
        ))}

        {/* Handle endpoint squares */}
        {anchors.map((a, i) => (
          <React.Fragment key={`h-end-${i}`}>
            {a.in && (
              <rect
                x={a.x + a.in.x - 4} y={a.y + a.in.y - 4}
                width={8} height={8}
                fill="#fbbf24"
                stroke="#0f172a"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {a.out && (
              <rect
                x={a.x + a.out.x - 4} y={a.y + a.out.y - 4}
                width={8} height={8}
                fill="#fbbf24"
                stroke="#0f172a"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </React.Fragment>
        ))}

        {/* Anchor dots — first anchor is green (start), others are amber.
            Smooth anchors are filled; corner anchors are outlined to make
            the distinction visible. */}
        {anchors.map((a, i) => {
          const smooth = !!(a.in || a.out);
          return (
            <circle
              key={`a-${i}`}
              cx={a.x}
              cy={a.y}
              r={6}
              fill={smooth ? (i === 0 ? '#22c55e' : '#fbbf24') : '#0f172a'}
              stroke={i === 0 ? '#22c55e' : '#fbbf24'}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          );
        })}
      </svg>

      {/* Floating instruction + action bar */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 shadow-2xl flex items-center gap-3">
          <span className="font-medium">{isMask ? 'Mask tool' : 'Pen tool'}</span>
          <span className="text-slate-400">
            {anchors.length === 0 ? (isMask ? 'Click around the part of the image to keep (drag to set curve)' : 'Click to start path (drag to set curve)')
              : `${anchors.length} anchor${anchors.length === 1 ? '' : 's'}`}
            {' · drag handles to reshape · right-click anchor to toggle smooth/corner'}
            {' · Enter to finish · Esc to cancel · Backspace to undo'}
          </span>
        </div>
        <button
          onClick={finish}
          disabled={anchors.length < minAnchors}
          className="pointer-events-auto px-3 py-1.5 text-xs font-medium rounded-lg transition bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-2xl"
        >
          {isMask ? 'Apply mask' : 'Finish'} ({anchors.length})
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
