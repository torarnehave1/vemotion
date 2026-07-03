import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CompositionData, Layer, PathAnchor, PathMask } from '../lib/api';

interface PathEditOverlayProps {
  composition: CompositionData;
  /** Current playhead time (seconds). Only paths active at this time are shown. */
  currentTime: number;
  /** Currently selected layer id — the selected path's anchors are highlighted. */
  selectedLayerId?: string | null;
  /** Select a path (e.g. to open the Path stream panel). Called on anchor click. */
  onSelectPath?: (id: string) => void;
  /** Replace a single path layer's properties (atomic). */
  onUpdatePath: (layerId: string, nextAnchors: PathAnchor[]) => void;
  /**
   * Replace the SELECTED image layer's mask anchors (local 0..1 space). When
   * provided, the selected image's committed mask outline renders as draggable
   * anchors + Bezier handles, same gestures as path layers.
   */
  onUpdateMask?: (layerId: string, nextAnchors: PathAnchor[]) => void;
}

const HIT_RADIUS_SCREEN_PX = 10;

/** Which anchor store a gesture edits: a path layer's `properties.anchors`
 *  (composition px) or an image layer's `properties.mask.anchors` (local 0..1). */
type Space = 'path' | 'mask';

type Gesture =
  | { kind: 'idle' }
  | { kind: 'dragging-anchor'; space: Space; layerId: string; anchorIdx: number; dx: number; dy: number }
  | { kind: 'dragging-handle'; space: Space; layerId: string; anchorIdx: number; which: 'in' | 'out'; mirror: boolean };

/**
 * Post-commit path editing overlay. Renders while Edit Mode is on; iterates
 * every `type: 'path'` layer in the composition and draws each layer's
 * anchors + handles as SVG elements ON TOP of the canvas.
 *
 * Click priority: the SVG root has `pointer-events: none`, individual
 * anchor / handle elements have `pointer-events: auto`. Effect: clicks on
 * an anchor or handle hit THIS overlay; clicks on empty canvas pass
 * through to VideoPreview's existing Edit-Mode layer drag.
 *
 * Gestures:
 *   - Drag anchor → moves the anchor; handles ride along.
 *   - Drag handle endpoint → reshapes that side of the curve. By default
 *     the opposite handle mirrors (smooth tangent preserved). Alt + drag
 *     breaks the mirror — Illustrator's "convert anchor point" gesture.
 *   - Right-click anchor → toggle smooth ⇄ corner.
 *
 * Updates flow to the parent via onUpdatePath which writes through to
 * Dashboard's setComposition. Per-mousemove writes are debounced server-
 * side by the autosave's 2.5s timer; client-side React re-renders are
 * fast because the [composition] effect re-uses the existing renderer
 * (no recreate).
 */
export const PathEditOverlay: React.FC<PathEditOverlayProps> = ({ composition, currentTime, selectedLayerId, onSelectPath, onUpdatePath, onUpdateMask }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: 'idle' });

  // ── Space conversion ─────────────────────────────────────────────────────
  // All rendering + gesture math runs in COMPOSITION px. Path layers store
  // anchors in that space already; mask anchors are LOCAL 0..1 fractions of
  // the image layer's box (PathMask contract) so they convert on read/write.
  const readCompAnchors = useCallback((layer: Layer, space: Space): PathAnchor[] => {
    if (space === 'path') {
      return ((layer.properties as Record<string, unknown>).anchors as PathAnchor[] | undefined) ?? [];
    }
    const mask = (layer.properties as Record<string, unknown>).mask as PathMask | undefined;
    if (!mask?.anchors) return [];
    const w = layer.size.width, h = layer.size.height;
    const ox = layer.position.x, oy = layer.position.y;
    return mask.anchors.map((a) => ({
      x: ox + a.x * w,
      y: oy + a.y * h,
      ...(a.in  ? { in:  { x: a.in.x  * w, y: a.in.y  * h } } : {}),
      ...(a.out ? { out: { x: a.out.x * w, y: a.out.y * h } } : {}),
    }));
  }, []);

  const writeCompAnchors = useCallback((layer: Layer, space: Space, next: PathAnchor[]) => {
    if (space === 'path') {
      onUpdatePath(layer.id, next);
      return;
    }
    if (!onUpdateMask) return;
    const w = layer.size.width || 1, h = layer.size.height || 1;
    const ox = layer.position.x, oy = layer.position.y;
    onUpdateMask(layer.id, next.map((a) => ({
      x: (a.x - ox) / w,
      y: (a.y - oy) / h,
      ...(a.in  ? { in:  { x: a.in.x  / w, y: a.in.y  / h } } : {}),
      ...(a.out ? { out: { x: a.out.x / w, y: a.out.y / h } } : {}),
    })));
  }, [onUpdatePath, onUpdateMask]);

  const clientToUserspace = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (clientX - rect.left) * (composition.width / rect.width),
      y: (clientY - rect.top) * (composition.height / rect.height),
    };
  }, [composition.width, composition.height]);

  const hitRadiusSvg = useCallback((): number => {
    const svg = svgRef.current;
    if (!svg) return HIT_RADIUS_SCREEN_PX;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return HIT_RADIUS_SCREEN_PX;
    return HIT_RADIUS_SCREEN_PX * (composition.width / rect.width);
  }, [composition.width]);

  // Path layers we'll render handles for (in render order, so later ones
  // sit on top visually — matches the canvas z-order).
  // Only paths active at the current playhead — a path scoped to another slide
  // must not clutter (or steal clicks on) the slide being edited. A path counts
  // as active if ITS window or ANY of its follower dots' windows contains the
  // playhead, so a path with a brief stroke window is still editable for the
  // whole slide its stream runs on.
  const activeAt = (l: Layer) => {
    const s = l.startTime ?? 0;
    const e = s + (l.layerDuration ?? composition.duration);
    return currentTime >= s && currentTime < e;
  };
  const dotStreamActive = (pid: string) => composition.layers.some((l) => {
    if (l.type !== 'shape') return false;
    const ms = ((l.properties as Record<string, unknown>)?.motionScenes as Array<{ pathLayerId?: string }>) || [];
    return ms.some((s) => s?.pathLayerId === pid) && activeAt(l);
  });
  const pathLayers: Layer[] = composition.layers.filter(
    (l) => l.type === 'path' && l.visible !== false && (activeAt(l) || dotStreamActive(l.id)),
  );

  // Window-level mousemove / mouseup during drag — catch releases that
  // land outside the SVG bounds.
  useEffect(() => {
    if (gesture.kind === 'idle') return;
    const onMove = (e: MouseEvent) => {
      const pt = clientToUserspace(e.clientX, e.clientY);
      if (!pt) return;
      if (gesture.kind === 'dragging-anchor') {
        const layer = composition.layers.find(l => l.id === gesture.layerId);
        if (!layer) return;
        const anchors = readCompAnchors(layer, gesture.space);
        const newX = pt.x - gesture.dx;
        const newY = pt.y - gesture.dy;
        const next = anchors.map((a, i) => i === gesture.anchorIdx ? { ...a, x: newX, y: newY } : a);
        writeCompAnchors(layer, gesture.space, next);
      } else if (gesture.kind === 'dragging-handle') {
        const layer = composition.layers.find(l => l.id === gesture.layerId);
        if (!layer) return;
        const anchors = readCompAnchors(layer, gesture.space);
        const anchor = anchors[gesture.anchorIdx];
        if (!anchor) return;
        const offsetX = pt.x - anchor.x;
        const offsetY = pt.y - anchor.y;
        const mirror = gesture.mirror && !e.altKey;
        const next = anchors.map((a, i) => {
          if (i !== gesture.anchorIdx) return a;
          const updated = { ...a };
          if (gesture.which === 'out') {
            updated.out = { x: offsetX, y: offsetY };
            if (mirror) updated.in = { x: -offsetX, y: -offsetY };
          } else {
            updated.in = { x: offsetX, y: offsetY };
            if (mirror) updated.out = { x: -offsetX, y: -offsetY };
          }
          return updated;
        });
        writeCompAnchors(layer, gesture.space, next);
      }
    };
    const onUp = () => setGesture({ kind: 'idle' });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [gesture, composition.layers, clientToUserspace, readCompAnchors, writeCompAnchors]);

  // Anchor mousedown — start anchor drag. Captures dx/dy so the anchor
  // doesn't jump to cursor centre on first move.
  const startAnchorDrag = (space: Space, layerId: string, anchorIdx: number, anchor: PathAnchor) => (e: React.MouseEvent) => {
    if (e.button !== 0) return; // left only
    e.preventDefault();
    e.stopPropagation();
    onSelectPath?.(layerId); // clicking an anchor selects its path (opens the Path stream panel)
    const pt = clientToUserspace(e.clientX, e.clientY);
    if (!pt) return;
    setGesture({
      kind: 'dragging-anchor',
      space,
      layerId,
      anchorIdx,
      dx: pt.x - anchor.x,
      dy: pt.y - anchor.y,
    });
  };

  // Handle mousedown — start handle drag (with Alt for break-mirror).
  const startHandleDrag = (space: Space, layerId: string, anchorIdx: number, which: 'in' | 'out') => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectPath?.(layerId);
    setGesture({
      kind: 'dragging-handle',
      space,
      layerId,
      anchorIdx,
      which,
      mirror: !e.altKey,
    });
  };

  // Right-click anchor — toggle smooth ⇄ corner. Same heuristic as the
  // Pen tool's right-click gesture.
  const toggleSmoothCorner = (space: Space, layerId: string, anchorIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const layer = composition.layers.find(l => l.id === layerId);
    if (!layer) return;
    const anchors = readCompAnchors(layer, space);
    const next = anchors.map((a, i) => {
      if (i !== anchorIdx) return a;
      if (a.in || a.out) {
        // Smooth → corner
        const { in: _in, out: _out, ...rest } = a;
        void _in; void _out;
        return rest;
      }
      // Corner → smooth: infer tangent from neighbours
      const prev = anchors[i - 1];
      const nxt = anchors[i + 1];
      let tx = 1, ty = 0;
      if (prev && nxt) { tx = nxt.x - prev.x; ty = nxt.y - prev.y; }
      else if (prev)   { tx = a.x - prev.x;  ty = a.y - prev.y; }
      else if (nxt)    { tx = nxt.x - a.x;   ty = nxt.y - a.y; }
      const len = Math.hypot(tx, ty) || 1;
      const reach = (len * 0.25) || 40;
      const ux = (tx / len) * reach;
      const uy = (ty / len) * reach;
      return { ...a, in: { x: -ux, y: -uy }, out: { x: ux, y: uy } };
    });
    writeCompAnchors(layer, space, next);
  };

  // The SELECTED image layer's committed mask, if any — its anchors render as
  // draggable points so a mask can be refined after commit without redrawing.
  const maskLayer: Layer | null = (() => {
    if (!onUpdateMask || !selectedLayerId) return null;
    const sel = composition.layers.find((l) => l.id === selectedLayerId);
    if (!sel || sel.type !== 'image') return null;
    const mask = (sel.properties as Record<string, unknown>).mask as PathMask | undefined;
    return mask?.anchors && mask.anchors.length >= 3 ? sel : null;
  })();

  // Suppress this overlay entirely if there's nothing to edit (saves DOM).
  if (pathLayers.length === 0 && !maskLayer) return null;
  // void hitRadiusSvg; // kept available if we add a path-stroke hit test later
  hitRadiusSvg;

  // One group of handle-lines + handle-squares + anchor dots, shared by path
  // layers and the selected image's mask. `accent` distinguishes the mask
  // (scissors pink) from paths (amber) at a glance.
  const renderAnchorGroup = (space: Space, layer: Layer, anchors: PathAnchor[], isSel: boolean, accent: string) => (
    <g key={`${space}-${layer.id}`} style={{ opacity: !selectedLayerId || isSel ? 1 : 0.45 }}>
      {/* Handle lines */}
      {anchors.map((a, i) => (
        <React.Fragment key={`h-${layer.id}-${i}`}>
          {a.in && (
            <line
              x1={a.x} y1={a.y} x2={a.x + a.in.x} y2={a.y + a.in.y}
              stroke="#94a3b8" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
          )}
          {a.out && (
            <line
              x1={a.x} y1={a.y} x2={a.x + a.out.x} y2={a.y + a.out.y}
              stroke="#94a3b8" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
          )}
        </React.Fragment>
      ))}
      {/* Handle endpoints (clickable squares) */}
      {anchors.map((a, i) => (
        <React.Fragment key={`he-${layer.id}-${i}`}>
          {a.in && (
            <rect
              x={a.x + a.in.x - 6} y={a.y + a.in.y - 6}
              width={12} height={12}
              fill={accent} stroke="#0f172a" strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onMouseDown={startHandleDrag(space, layer.id, i, 'in')}
            />
          )}
          {a.out && (
            <rect
              x={a.x + a.out.x - 6} y={a.y + a.out.y - 6}
              width={12} height={12}
              fill={accent} stroke="#0f172a" strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onMouseDown={startHandleDrag(space, layer.id, i, 'out')}
            />
          )}
        </React.Fragment>
      ))}
      {/* Anchor dots (clickable). Smooth = filled, corner = outlined. */}
      {anchors.map((a, i) => {
        const smooth = !!(a.in || a.out);
        const isStart = i === 0;
        return (
          <circle
            key={`a-${layer.id}-${i}`}
            cx={a.x} cy={a.y} r={isSel ? 10 : 8}
            fill={smooth ? (isStart ? '#22c55e' : accent) : '#0f172a'}
            stroke={isSel ? '#38bdf8' : (isStart ? '#22c55e' : accent)}
            strokeWidth={isSel ? 3 : 2}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            onMouseDown={startAnchorDrag(space, layer.id, i, a)}
            onContextMenu={toggleSmoothCorner(space, layer.id, i)}
          />
        );
      })}
    </g>
  );

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 ${composition.width} ${composition.height}`}
      preserveAspectRatio="none"
      style={{ pointerEvents: 'none' }} // empty areas pass through to canvas
    >
      {pathLayers.map(layer =>
        renderAnchorGroup('path', layer, readCompAnchors(layer, 'path'), layer.id === selectedLayerId, '#fbbf24'),
      )}
      {maskLayer && renderAnchorGroup('mask', maskLayer, readCompAnchors(maskLayer, 'mask'), true, '#f472b6')}
    </svg>
  );
};
