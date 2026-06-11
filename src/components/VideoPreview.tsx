import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Square, Download, MousePointer2, PenTool, Scissors, Eraser } from 'lucide-react';
import { CanvasRenderer, PlaybackController } from '../lib/renderer';
import { AudioPlaybackController } from '../lib/audioPlayback';
import type { CompositionData, Layer, PathAnchor, PathMask, Guide } from '../lib/api';
import { layerLabel } from '../lib/api';
import { PenToolOverlay } from './PenToolOverlay';
import { PathEditOverlay } from './PathEditOverlay';

interface VideoPreviewProps {
  composition: CompositionData;
  onFrameChange?: (frame: number) => void;
  externalSeekFrame?: number;
  /**
   * When true, hide editor-only affordances (zoom selector, Export MP4 button).
   * Play/Pause/Stop, scrub bar, frame counter, and composition info row remain.
   * Used by the iframe-embed flow (see ?embed=1 in App.tsx / EmbedView).
   */
  embed?: boolean;
  /**
   * Commit a new layer position after a drag in Edit mode. Called once on
   * mouseup. During the drag itself, the renderer is updated optimistically
   * without going through React state.
   */
  onLayerMove?: (layerId: string, position: { x: number; y: number }) => void;
  /**
   * Append one or more new layers (in render order — last is drawn on top).
   * Used by the Pen Tool when finishing a path: it emits two layers
   * atomically — the path itself plus a default follower dot whose
   * motionScene references the path id. Caller decides where the layers
   * land (typically just appended to composition.layers).
   */
  onAddLayers?: (layers: Layer[]) => void;
  /**
   * Replace a single path layer's `properties.anchors` array. Called
   * during post-commit path editing (PathEditOverlay) on each
   * mousemove of an anchor / handle drag. Autosave debounces the
   * server write.
   */
  onUpdatePathAnchors?: (layerId: string, anchors: PathAnchor[]) => void;
  /**
   * Set (or replace) an image layer's clip mask (`properties.mask`). Called once
   * when a mask is committed from the pen tool in mask mode. Anchors are already
   * in the layer's LOCAL 0..1 space. Rides the existing autosave pipeline.
   */
  onUpdateLayerMask?: (layerId: string, mask: PathMask) => void;
  /**
   * Remove an image layer's clip mask (delete `properties.mask`) → the full
   * image returns. Called by the "Remove mask" button. Rides autosave.
   */
  onRemoveLayerMask?: (layerId: string) => void;
  /**
   * Replace the composition's ruler guides (composition.meta.guides). Called
   * when a guide is created (dragged from a ruler), moved, or deleted (dragged
   * off-canvas). When omitted, the rulers + guide interactions are disabled.
   */
  onUpdateGuides?: (guides: Guide[]) => void;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ composition, onFrameChange, externalSeekFrame, embed, onLayerMove, onAddLayers, onUpdatePathAnchors, onUpdateLayerMask, onRemoveLayerMask, onUpdateGuides }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  // Audio companion to PlaybackController. One controller per VideoPreview
  // mount, swapped composition reference on edits. Driven by onFrameChange
  // and the play/pause/stop/seek handlers below — see audioPlayback.ts.
  const audioCtrlRef = useRef<AudioPlaybackController | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // Edit mode (Q2β): explicit toggle. When on, mousedown on a layer selects
  // it and starts a drag-to-move; click on empty canvas deselects. Pan / zoom
  // remain available on empty canvas only when edit mode is OFF.
  const [editMode, setEditMode] = useState(false);
  // Pen Mode — mutually exclusive with Edit Mode. Switching one on turns
  // the other off (see the toggle effects below).
  const [penMode, setPenMode] = useState(false);
  // When non-null, the pen tool is in MASK mode authoring a clip outline for
  // this image layer (instead of creating a new path layer). Set by the Mask
  // button; cleared whenever pen mode exits.
  const [maskTargetId, setMaskTargetId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [hoverLayerId, setHoverLayerId] = useState<string | null>(null);
  // Drag in-flight state. Tracks final committed position; on mouseup we
  // call onLayerMove once so React state mutation happens exactly once per drag.
  const draggingRef = useRef<{
    layerId: string;
    clickOffsetX: number;
    clickOffsetY: number;
    finalX: number;
    finalY: number;
  } | null>(null);

  const totalFrames = Math.floor(composition.duration * composition.fps);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [zoom, composition.width, composition.height]);

  // Mount-once: create renderer + controller.
  //
  // Previously this effect was keyed on [composition], which recreated the
  // renderer and reset currentFrame to 0 on EVERY composition mutation —
  // making every property edit (and now every Edit-mode drag commit) snap
  // the preview to frame 0. That's a pre-existing bug; fixing it as part of
  // this slice because the drag flow makes it impossible to ignore.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new CanvasRenderer(canvas);
    // Editor-only: draw persisted ruler guides. Embed/iframe player and the
    // exporter never enable this, so guides stay out of the final video.
    renderer.showGuides = !embed;
    const controller = new PlaybackController(renderer, composition);
    const audioCtrl = new AudioPlaybackController(composition);

    // Repaint the current frame when an async asset becomes paintable — a
    // lazily-loaded image, or a video frame that just finished seeking while
    // paused. Without this, a paused scrub shows a stale/blank frame until the
    // next playback tick (which never comes while paused).
    renderer.onImageLoad = () => {
      const c = controllerRef.current;
      if (c) void renderer.renderFrame(c.composition, c.currentFrame);
    };

    controller.onFrameChange = (frame) => {
      setCurrentFrame(frame);
      onFrameChange?.(frame);
      // Drive audio in lockstep with the visual clock. PlaybackController
      // already knows its composition and fps, but we recompute time here so
      // the audio sync uses the SAME frame number React is about to render.
      audioCtrl.syncToTime(frame / composition.fps, true);
    };
    controller.onEnd = () => {
      setIsPlaying(false);
      audioCtrl.pauseAll();
    };

    rendererRef.current = renderer;
    controllerRef.current = controller;
    audioCtrlRef.current = audioCtrl;

    // Render first frame immediately.
    void renderer.renderFrame(composition, 0);
    setCurrentFrame(0);
    audioCtrl.syncToTime(0, false);

    return () => {
      controller.pause();
      audioCtrl.destroy();
      rendererRef.current = null;
      controllerRef.current = null;
      audioCtrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Composition-update: feed the latest composition into the existing
  // controller and re-render at the CURRENT frame (clamped to the new total).
  useEffect(() => {
    const renderer = rendererRef.current;
    const controller = controllerRef.current;
    const audioCtrl = audioCtrlRef.current;
    if (!renderer || !controller) return;
    controller.composition = composition;
    audioCtrl?.setComposition(composition);
    const total = Math.max(1, Math.floor(composition.duration * composition.fps));
    const safeFrame = Math.max(0, Math.min(currentFrame, total - 1));
    void renderer.renderFrame(composition, safeFrame);
    if (safeFrame !== currentFrame) setCurrentFrame(safeFrame);
    audioCtrl?.syncToTime(safeFrame / composition.fps, isPlaying);
    // currentFrame / isPlaying intentionally NOT in deps — we read but don't
    // want to refire on every frame tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition]);

  // Selection change: sync renderer's selectedLayerId and re-render so the
  // overlay appears / disappears immediately.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.selectedLayerId = selectedLayerId;
    void renderer.renderFrame(composition, currentFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  // Entering edit mode pauses playback. Leaving leaves playback wherever it is
  // (the user picks Play themselves to resume).
  useEffect(() => {
    if (editMode) {
      controllerRef.current?.pause();
      setIsPlaying(false);
      // Mutually exclusive with Pen Mode.
      setPenMode(false);
    } else {
      setSelectedLayerId(null);
      setHoverLayerId(null);
    }
  }, [editMode]);

  // Pen Mode toggle effects. Mutually exclusive with Edit Mode + pauses
  // playback so the canvas is steady while you're authoring.
  useEffect(() => {
    if (penMode) {
      controllerRef.current?.pause();
      setIsPlaying(false);
      setEditMode(false);
      setSelectedLayerId(null);
      setHoverLayerId(null);
    } else {
      // Leaving pen mode (finish, cancel, or toggling the button) always
      // clears the mask target so the next pen session starts as a plain path.
      setMaskTargetId(null);
    }
  }, [penMode]);

  // Pen-tool finish handler: receives the path layer authored in the
  // overlay and emits two layers atomically — the path + a default
  // follower dot whose motionScene references the path id. Reuses the
  // existing onAddLayers wire so autosave catches the change.
  const handlePenFinish = useCallback((pathLayer: Layer) => {
    // ── Mask mode ──────────────────────────────────────────────────────────
    // The outline was authored in composition-pixel coords. Convert each anchor
    // (and its Bezier handles) into the target image layer's LOCAL 0..1 space so
    // the mask travels + scales with the image (PathMask contract). Then hand it
    // to the mask-update callback instead of adding a new path layer.
    if (maskTargetId) {
      const target = composition.layers.find((l) => l.id === maskTargetId);
      const px = (pathLayer.properties.anchors as PathAnchor[] | undefined) ?? [];
      if (onUpdateLayerMask && target && target.size.width > 0 && target.size.height > 0 && px.length >= 3) {
        const w = target.size.width;
        const h = target.size.height;
        const ox = target.position.x;
        const oy = target.position.y;
        const localAnchors: PathAnchor[] = px.map((a) => ({
          x: (a.x - ox) / w,
          y: (a.y - oy) / h,
          ...(a.in  ? { in:  { x: a.in.x  / w, y: a.in.y  / h } } : {}),
          ...(a.out ? { out: { x: a.out.x / w, y: a.out.y / h } } : {}),
        }));
        onUpdateLayerMask(maskTargetId, { type: 'path', anchors: localAnchors });
      }
      setPenMode(false); // effect clears maskTargetId
      return;
    }

    // ── Path mode (default) ────────────────────────────────────────────────
    if (!onAddLayers) {
      setPenMode(false);
      return;
    }
    const dotId = `layer-${Date.now().toString(36)}-dot`;
    const dotLayer: Layer = {
      id: dotId,
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { width: 14, height: 14 },
      startTime: 0,
      layerDuration: composition.duration,
      properties: {
        shape: 'circle',
        color: '#38bdf8',           // sky-400 to match the editor accent
        opacity: 1,
        strokeColor: '#0c4a6e',     // sky-900
        strokeWidth: 2,
        motionScenes: [
          {
            start: 0,
            end: composition.duration,
            pathLayerId: pathLayer.id,
          },
        ],
      },
    };
    onAddLayers([pathLayer, dotLayer]);
    setPenMode(false);
  }, [composition.duration, composition.layers, onAddLayers, maskTargetId, onUpdateLayerMask]);

  // Seek when timeline sends a frame
  useEffect(() => {
    if (externalSeekFrame === undefined) return;
    controllerRef.current?.pause();
    controllerRef.current?.seekToFrame(externalSeekFrame);
    audioCtrlRef.current?.syncToTime(externalSeekFrame / composition.fps, false);
    setIsPlaying(false);
    setCurrentFrame(externalSeekFrame);
  }, [externalSeekFrame, composition.fps]);

  const handlePlay = useCallback(() => {
    controllerRef.current?.play();
    setIsPlaying(true);
    audioCtrlRef.current?.syncToTime(currentFrame / composition.fps, true);
  }, [composition.fps, currentFrame]);

  const handlePause = useCallback(() => {
    controllerRef.current?.pause();
    setIsPlaying(false);
    audioCtrlRef.current?.pauseAll();
  }, []);

  const handleStop = useCallback(() => {
    controllerRef.current?.stop();
    setIsPlaying(false);
    setCurrentFrame(0);
    audioCtrlRef.current?.stopAll();
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value);
    controllerRef.current?.pause();
    controllerRef.current?.seekToFrame(frame);
    audioCtrlRef.current?.syncToTime(frame / composition.fps, false);
    setIsPlaying(false);
    setCurrentFrame(frame);
  }, [composition.fps]);

  const clampPan = useCallback((nextX: number, nextY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return { x: nextX, y: nextY };
    const baseWidth = Math.min(viewport.clientWidth, (viewport.clientHeight * composition.width) / composition.height);
    const baseHeight = baseWidth * (composition.height / composition.width);
    const maxX = Math.max(0, (baseWidth * zoom - baseWidth) / 2);
    const maxY = Math.max(0, (baseHeight * zoom - baseHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    };
  }, [composition.height, composition.width, zoom]);

  const handlePanStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialPan = { ...pan };
    setIsPanning(true);

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPan(clampPan(initialPan.x + dx, initialPan.y + dy));
    };

    const onUp = () => {
      setIsPanning(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clampPan, pan, zoom]);

  // Convert a client-space mouse event to canvas-pixel coordinates. The canvas
  // is rendered at the composition's native resolution but displayed at a
  // smaller CSS size; getBoundingClientRect already accounts for the wrapper's
  // CSS transform (zoom + pan), so this single ratio handles everything.
  const toCanvasCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  // Ruler drag → create a guide. axis 'y' = top ruler (drag down → horizontal
  // guide); axis 'x' = left ruler (drag right → vertical guide). The guide
  // position is read from the cursor's CANVAS coordinate at drop time (via
  // toCanvasCoords, which already accounts for zoom/pan), so the unscaled
  // ruler strip only needs to start the drag, not measure it.
  const handleRulerMouseDown = useCallback((axis: 'x' | 'y') => (e: React.MouseEvent) => {
    const renderer = rendererRef.current;
    if (!renderer || !onUpdateGuides) return;
    e.preventDefault();
    let lastPos = 0;
    let inside = false;

    const onMove = (ev: MouseEvent) => {
      const c = toCanvasCoords(ev.clientX, ev.clientY);
      if (!c) return;
      inside = c.x >= 0 && c.x <= composition.width && c.y >= 0 && c.y <= composition.height;
      const raw = axis === 'x' ? c.x : c.y;
      const max = axis === 'x' ? composition.width : composition.height;
      lastPos = Math.max(0, Math.min(max, raw));
      renderer.draftGuide = inside ? { axis, position: lastPos } : null;
      void renderer.renderFrame(composition, currentFrame);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      renderer.draftGuide = null;
      if (inside) {
        const guide: Guide = { id: `guide-${Date.now().toString(36)}`, axis, position: Math.round(lastPos) };
        onUpdateGuides([...(composition.meta?.guides ?? []), guide]);
        // composition prop updates → [composition] effect re-renders with the
        // new guide committed; no manual renderFrame needed here.
      } else {
        void renderer.renderFrame(composition, currentFrame);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [composition, currentFrame, onUpdateGuides, toCanvasCoords]);

  // Combined mousedown — guide grab has top priority (any mode), then
  // edit-mode hit test; otherwise fall through to the existing pan handler.
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Guide grab: drag an existing guide to reposition, or off-canvas to delete.
    const guides = composition.meta?.guides ?? [];
    if (guides.length > 0 && onUpdateGuides && rendererRef.current) {
      const gc = toCanvasCoords(e.clientX, e.clientY);
      if (gc) {
        const GUIDE_HIT = 8;
        const hit = guides.find(g => g.axis === 'x'
          ? Math.abs(gc.x - g.position) <= GUIDE_HIT
          : Math.abs(gc.y - g.position) <= GUIDE_HIT);
        if (hit) {
          e.preventDefault();
          const renderer = rendererRef.current;
          const others = guides.filter(g => g.id !== hit.id);
          let lastPos = hit.position;
          let offCanvas = false;
          const onMove = (ev: MouseEvent) => {
            const c = toCanvasCoords(ev.clientX, ev.clientY);
            if (!c) return;
            offCanvas = c.x < 0 || c.x > composition.width || c.y < 0 || c.y > composition.height;
            const raw = hit.axis === 'x' ? c.x : c.y;
            const max = hit.axis === 'x' ? composition.width : composition.height;
            lastPos = Math.max(0, Math.min(max, raw));
            const tempComp: CompositionData = { ...composition, meta: { ...composition.meta, guides: others } };
            renderer.draftGuide = offCanvas ? null : { axis: hit.axis, position: lastPos };
            void renderer.renderFrame(tempComp, currentFrame);
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            renderer.draftGuide = null;
            if (offCanvas) {
              onUpdateGuides(others);
            } else {
              onUpdateGuides([...others, { ...hit, position: Math.round(lastPos) }]);
            }
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }
      }
    }

    if (!editMode || !rendererRef.current) {
      handlePanStart(e);
      return;
    }

    const coords = toCanvasCoords(e.clientX, e.clientY);
    if (!coords) {
      handlePanStart(e);
      return;
    }

    const time = currentFrame / composition.fps;
    const hitId = rendererRef.current.hitTest(coords.x, coords.y, composition, time);

    if (!hitId) {
      // Empty canvas click in edit mode → deselect. Don't start a pan;
      // edit mode should feel like a separate interaction layer.
      setSelectedLayerId(null);
      return;
    }

    // Selected and ready to drag.
    const layer = composition.layers.find(l => l.id === hitId);
    if (!layer) return;
    e.preventDefault();
    setSelectedLayerId(hitId);

    // Capture the click offset relative to the layer's BASE position
    // (not its animated-offset position). On move, new base = click_now -
    // offset; animation offsets stay intact.
    const clickOffsetX = coords.x - layer.position.x;
    const clickOffsetY = coords.y - layer.position.y;

    draggingRef.current = {
      layerId: hitId,
      clickOffsetX,
      clickOffsetY,
      finalX: layer.position.x,
      finalY: layer.position.y,
    };

    // Smart-guide snap threshold in canvas pixels. Not zoom-aware in v1 —
    // if it ever feels too sticky at high zoom (or too loose at low zoom),
    // scale by `1/zoom` here.
    const SNAP_THRESHOLD = 8;

    const onDragMove = (moveEvent: MouseEvent) => {
      const drag = draggingRef.current;
      if (!drag) return;
      const now = toCanvasCoords(moveEvent.clientX, moveEvent.clientY);
      if (!now) return;
      let newX = now.x - drag.clickOffsetX;
      let newY = now.y - drag.clickOffsetY;

      // Centre-snap (Illustrator / Figma idiom). The centre we check is the
      // layer's BASE bounding-rect centre (position + size/2), NOT the
      // animated-offset centre — drag pauses playback, so for typical
      // compositions (no persistent offsetX/Y at the current frame) these
      // coincide. Documented caveat: a layer with a constant offset
      // animation will snap its BASE centre, not its visual centre, which
      // matters only if both offsets are non-zero at the dragged frame.
      const layerRef = composition.layers.find(l => l.id === drag.layerId);
      const layerW = layerRef?.size.width ?? 0;
      const layerH = layerRef?.size.height ?? 0;
      const canvasCx = composition.width / 2;
      const canvasCy = composition.height / 2;
      const centreX = newX + layerW / 2;
      const centreY = newY + layerH / 2;

      const showVerticalGuide = Math.abs(centreX - canvasCx) < SNAP_THRESHOLD;
      const showHorizontalGuide = Math.abs(centreY - canvasCy) < SNAP_THRESHOLD;
      if (showVerticalGuide) newX = canvasCx - layerW / 2;
      if (showHorizontalGuide) newY = canvasCy - layerH / 2;

      // Also snap the layer centre to any ruler guide within threshold. A
      // guide hit overrides the canvas-centre snap when both are in range.
      for (const g of composition.meta?.guides ?? []) {
        if (g.axis === 'x' && Math.abs(centreX - g.position) < SNAP_THRESHOLD) newX = g.position - layerW / 2;
        if (g.axis === 'y' && Math.abs(centreY - g.position) < SNAP_THRESHOLD) newY = g.position - layerH / 2;
      }

      drag.finalX = newX;
      drag.finalY = newY;

      // Optimistic render: synthesize a composition with the dragged layer
      // moved to its new position and re-render at the current frame. React
      // state is untouched until mouseup, so the [composition] effect
      // doesn't re-run on every move.
      const renderer = rendererRef.current;
      if (!renderer) return;
      const tempComp: CompositionData = {
        ...composition,
        layers: composition.layers.map(l => l.id === drag.layerId
          ? { ...l, position: { x: newX, y: newY } }
          : l),
      };
      renderer.selectedLayerId = drag.layerId;
      renderer.snapGuides = (showVerticalGuide || showHorizontalGuide)
        ? { vertical: showVerticalGuide, horizontal: showHorizontalGuide }
        : null;
      void renderer.renderFrame(tempComp, currentFrame);
    };

    const onDragUp = () => {
      const drag = draggingRef.current;
      draggingRef.current = null;
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragUp);
      // Guides only appear while dragging — clear and re-render so the
      // final frame doesn't keep a stale magenta line.
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.snapGuides = null;
        void renderer.renderFrame(composition, currentFrame);
      }
      if (!drag) return;
      // Only commit if the position actually changed (avoid a noisy
      // composition mutation on bare clicks).
      const layerNow = composition.layers.find(l => l.id === drag.layerId);
      if (!layerNow) return;
      if (layerNow.position.x === drag.finalX && layerNow.position.y === drag.finalY) return;
      onLayerMove?.(drag.layerId, { x: drag.finalX, y: drag.finalY });
    };

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  }, [editMode, composition, currentFrame, handlePanStart, onLayerMove, toCanvasCoords, onUpdateGuides]);

  // Cursor feedback: in edit mode, show grab when hovering a layer.
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!editMode || !rendererRef.current || draggingRef.current) {
      if (hoverLayerId !== null) setHoverLayerId(null);
      return;
    }
    const coords = toCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;
    const time = currentFrame / composition.fps;
    const hitId = rendererRef.current.hitTest(coords.x, coords.y, composition, time);
    if (hitId !== hoverLayerId) setHoverLayerId(hitId);
  }, [editMode, composition, currentFrame, hoverLayerId, toCanvasCoords]);

  const currentTime = (currentFrame / composition.fps).toFixed(2);
  const totalTime = composition.duration.toFixed(2);
  const progressPct = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">

      {/* Canvas */}
      <div className="space-y-3">
        {!embed && (
          <div className="flex items-center justify-end gap-2">
            <label htmlFor="preview-zoom" className="text-xs font-medium text-slate-400">Zoom</label>
            <select
              id="preview-zoom"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="bg-slate-800 border border-slate-700 text-white rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </select>
          </div>
        )}

        {!embed && onUpdateGuides && (
          <p className="text-[11px] text-slate-500">
            Drag from the rulers to add snap guides. Drag a guide off the canvas to remove it.
          </p>
        )}
        <div
          className={!embed && onUpdateGuides ? 'grid' : undefined}
          style={!embed && onUpdateGuides ? { gridTemplateColumns: '16px minmax(0,1fr)', gridTemplateRows: '16px auto' } : undefined}
        >
          {!embed && onUpdateGuides && (
            <>
              <div className="bg-slate-800/70 border-b border-r border-slate-700 rounded-tl" />
              <div
                onMouseDown={handleRulerMouseDown('y')}
                title="Drag down to add a horizontal guide"
                className="bg-slate-800/70 border-b border-slate-700 cursor-row-resize hover:bg-slate-700/70 transition-colors"
              />
              <div
                onMouseDown={handleRulerMouseDown('x')}
                title="Drag right to add a vertical guide"
                className="bg-slate-800/70 border-r border-slate-700 cursor-col-resize hover:bg-slate-700/70 transition-colors"
              />
            </>
          )}
        <div
          ref={viewportRef}
          className="flex justify-center overflow-hidden rounded-lg"
        >
          <div
            className="relative bg-black rounded-lg overflow-hidden"
            style={{
              aspectRatio: `${composition.width}/${composition.height}`,
              maxHeight: '50vh',
              width: `min(100%, calc(50vh * ${composition.width} / ${composition.height}))`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              cursor: draggingRef.current
                ? 'grabbing'
                : editMode
                ? (hoverLayerId ? 'grab' : 'crosshair')
                : zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverLayerId(null)}
          >
            <canvas ref={canvasRef} className="w-full h-full" />
            {penMode && (
              <PenToolOverlay
                compositionWidth={composition.width}
                compositionHeight={composition.height}
                mode={maskTargetId ? 'mask' : 'path'}
                onFinish={handlePenFinish}
                onCancel={() => setPenMode(false)}
              />
            )}
            {editMode && !penMode && onUpdatePathAnchors && (
              <PathEditOverlay
                composition={composition}
                onUpdatePath={onUpdatePathAnchors}
              />
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Scrubber */}
      <div className="space-y-2">
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={currentFrame}
          onChange={handleScrub}
          className="w-full accent-sky-500"
        />
        <div className="flex justify-between text-xs text-slate-400">
          <span>Frame {currentFrame} / {totalFrames}</span>
          <span>{currentTime}s / {totalTime}s</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-800 rounded-full h-1">
        <div
          className="bg-sky-600 h-1 rounded-full transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {isPlaying ? (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition"
          >
            <Pause className="w-4 h-4" /> Pause
          </button>
        ) : (
          <button
            onClick={handlePlay}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition"
          >
            <Play className="w-4 h-4" /> Play
          </button>
        )}
        <button
          onClick={handleStop}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition"
        >
          <Square className="w-4 h-4" /> Stop
        </button>
        {!embed && (
          <>
            <button
              onClick={() => setEditMode(v => !v)}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border',
                editMode
                  ? 'bg-sky-600 hover:bg-sky-500 text-white border-sky-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
              ].join(' ')}
              title={editMode ? 'Exit edit mode (deselects, returns to preview)' : 'Enter edit mode (click layers to select and drag to move)'}
            >
              <MousePointer2 className="w-4 h-4" />
              {editMode ? 'Editing' : 'Edit'}
            </button>
            <button
              onClick={() => setPenMode(v => !v)}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border',
                penMode
                  ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
              ].join(' ')}
              title={penMode ? 'Exit pen mode' : 'Pen tool — click on canvas to drop anchors, Enter to finish (auto-adds a follower dot)'}
            >
              <PenTool className="w-4 h-4" />
              {penMode ? 'Drawing' : 'Pen'}
            </button>
            {/* Mask button — only for a selected IMAGE layer. Enters the pen
                tool in mask mode bound to that image; the committed outline
                becomes the image's clip mask (collage cut-out). */}
            {editMode && selectedLayerId && onUpdateLayerMask && (() => {
              const sel = composition.layers.find((l) => l.id === selectedLayerId);
              if (!sel || sel.type !== 'image') return null;
              const hasMask = !!(sel.properties as Record<string, unknown>).mask;
              return (
                <>
                  <button
                    onClick={() => { setMaskTargetId(selectedLayerId); setPenMode(true); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                    title={hasMask ? 'Redraw this image’s clip mask' : 'Draw a clip mask to cut this image into a shape'}
                  >
                    <Scissors className="w-4 h-4" />
                    {hasMask ? 'Redraw mask' : 'Mask'}
                  </button>
                  {hasMask && onRemoveLayerMask && (
                    <button
                      onClick={() => onRemoveLayerMask(selectedLayerId)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border bg-slate-800 hover:bg-rose-900/40 text-slate-200 border-slate-700 hover:border-rose-700"
                      title="Remove the clip mask — the full image returns"
                    >
                      <Eraser className="w-4 h-4" />
                      Remove mask
                    </button>
                  )}
                </>
              );
            })()}
            {editMode && selectedLayerId && (() => {
              const sel = composition.layers.find((l) => l.id === selectedLayerId);
              return (
                <span className="text-xs font-mono text-slate-400 truncate max-w-[12rem]" title={selectedLayerId}>
                  Selected: {sel ? layerLabel(sel) : selectedLayerId}
                </span>
              );
            })()}
            <div className="ml-auto">
              <button className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition">
                <Download className="w-4 h-4" /> Export MP4
              </button>
            </div>
          </>
        )}
      </div>

      {/* Composition info */}
      <div className="flex gap-4 text-xs text-slate-500 pt-2 border-t border-slate-800">
        <span>{composition.width}×{composition.height}</span>
        <span>{composition.fps} fps</span>
        <span>{composition.duration}s</span>
        <span>{composition.layers.length} layer{composition.layers.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};
