import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Square, Download, MousePointer2, PenTool, Scissors, Eraser, Stamp } from 'lucide-react';
import { CanvasRenderer, PlaybackController, type ResizeHandle } from '../lib/renderer';
import { AudioPlaybackController } from '../lib/audioPlayback';
import type { CompositionData, Layer, PathAnchor, PathMask, ImagePatch, Guide } from '../lib/api';
import { layerLabel } from '../lib/api';
import { PenToolOverlay } from './PenToolOverlay';
import { PatchToolOverlay } from './PatchToolOverlay';
import { PathEditOverlay } from './PathEditOverlay';

interface VideoPreviewProps {
  composition: CompositionData;
  onFrameChange?: (frame: number) => void;
  externalSeekFrame?: number;
  /**
   * Shared selected-layer id. When this changes from outside (e.g. a timeline
   * row was clicked) the canvas selects that layer too — keeps canvas + timeline
   * selection in sync. Undefined = uncontrolled (canvas manages its own).
   */
  selectedLayerId?: string | null;
  /**
   * Report the canvas's current layer selection up so the timeline can highlight
   * the same row. Fired whenever the canvas selection changes.
   */
  onSelectLayer?: (id: string | null) => void;
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
   * Commit a new layer position + size after a resize-handle drag in Edit mode.
   * Called once on mouseup. During the drag the renderer updates optimistically
   * without going through React state (same pattern as onLayerMove).
   */
  onLayerResize?: (layerId: string, position: { x: number; y: number }, size: { width: number; height: number }) => void;
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
   * Set the feather (soft-edge px) on an image layer's existing mask. Called
   * live as the canvas Feather slider moves. 0 = hard edge. Rides autosave.
   */
  onSetMaskFeather?: (layerId: string, feather: number) => void;
  /**
   * Toggle invert on an image layer's existing mask (clip outside the outline).
   * Called by the canvas Invert toggle. false = keep inside. Rides autosave.
   */
  onSetMaskInvert?: (layerId: string, invert: boolean) => void;
  /**
   * Append a clone/heal patch to an image layer (`properties.patches[]`). Called
   * when the Patch tool commits — outline + source are already in the layer's
   * LOCAL 0..1 space. Rides the existing autosave pipeline.
   */
  onAddPatch?: (layerId: string, patch: ImagePatch) => void;
  /**
   * Remove ALL clone patches from an image layer (delete `properties.patches`).
   * Called by the "Clear patches" button. Rides autosave.
   */
  onClearPatches?: (layerId: string) => void;
  /**
   * Replace the composition's ruler guides (composition.meta.guides). Called
   * when a guide is created (dragged from a ruler), moved, or deleted (dragged
   * off-canvas). When omitted, the rulers + guide interactions are disabled.
   */
  onUpdateGuides?: (guides: Guide[]) => void;
}

const MIN_SIZE = 8; // smallest layer box a resize can produce (canvas px)

/** CSS cursor for a given resize handle (Illustrator diagonal/axis cursors). */
function handleCursor(handle: ResizeHandle): string {
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  if (handle === 'n' || handle === 's') return 'ns-resize';
  return 'ew-resize'; // 'e' | 'w'
}

/**
 * Recompute a layer box from a resize-handle drag. The opposite edge(s) stay
 * fixed (L0/T0/R0/B0 captured at mousedown); the moving edge(s) follow the
 * mouse. `constrain` (Shift held) locks the original aspect ratio: corners
 * scale by the larger axis delta; edge handles scale the perpendicular axis too,
 * centred on the fixed edge's midpoint. Box never shrinks below MIN_SIZE.
 */
function computeResizedBox(
  handle: ResizeHandle,
  L0: number, T0: number, R0: number, B0: number,
  mx: number, my: number,
  constrain: boolean,
): { x: number; y: number; w: number; h: number } {
  const w0 = R0 - L0;
  const h0 = B0 - T0;
  const movesLeft   = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight  = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop    = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (constrain && w0 > 0 && h0 > 0) {
    const sx = movesRight ? 1 : movesLeft ? -1 : 0;
    const sy = movesBottom ? 1 : movesTop ? -1 : 0;
    const ax = movesRight ? L0 : movesLeft ? R0 : (L0 + R0) / 2; // fixed anchor x
    const ay = movesBottom ? T0 : movesTop ? B0 : (T0 + B0) / 2; // fixed anchor y
    let sc: number;
    if (sx !== 0 && sy !== 0) sc = Math.max(Math.abs(mx - ax) / w0, Math.abs(my - ay) / h0);
    else if (sx !== 0)       sc = Math.abs(mx - ax) / w0;
    else                     sc = Math.abs(my - ay) / h0;
    const minSc = Math.max(MIN_SIZE / w0, MIN_SIZE / h0);
    if (sc < minSc) sc = minSc;
    const w = w0 * sc;
    const h = h0 * sc;
    const x = sx > 0 ? ax : sx < 0 ? ax - w : ax - w / 2;
    const y = sy > 0 ? ay : sy < 0 ? ay - h : ay - h / 2;
    return { x, y, w, h };
  }

  // Free resize — moving edge tracks the mouse, opposite edge fixed.
  let x: number, w: number;
  if (movesLeft)       { w = Math.max(MIN_SIZE, R0 - mx); x = R0 - w; }
  else if (movesRight) { w = Math.max(MIN_SIZE, mx - L0); x = L0; }
  else                 { w = w0; x = L0; }
  let y: number, h: number;
  if (movesTop)         { h = Math.max(MIN_SIZE, B0 - my); y = B0 - h; }
  else if (movesBottom) { h = Math.max(MIN_SIZE, my - T0); y = T0; }
  else                  { h = h0; y = T0; }
  return { x, y, w, h };
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ composition, onFrameChange, externalSeekFrame, selectedLayerId: externalSelectedLayerId, onSelectLayer, embed, onLayerMove, onLayerResize, onAddLayers, onUpdatePathAnchors, onUpdateLayerMask, onRemoveLayerMask, onSetMaskFeather, onSetMaskInvert, onAddPatch, onClearPatches, onUpdateGuides }) => {
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
  // When non-null, the Patch (clone-stamp) tool is authoring a clone patch for
  // this image layer. Mutually exclusive with pen/edit interactions (the overlay
  // sits on top of the canvas and captures its own events).
  const [patchTargetId, setPatchTargetId] = useState<string | null>(null);
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
  // Resize in-flight state. Captures the layer's BASE box edges at mousedown
  // (L0/T0/R0/B0 = left/top/right/bottom) so each move recomputes the box from
  // the fixed anchor edge(s). Commits position+size once on mouseup.
  const resizingRef = useRef<{
    layerId: string;
    handle: ResizeHandle;
    L0: number; T0: number; R0: number; B0: number;
    finalX: number; finalY: number; finalW: number; finalH: number;
  } | null>(null);
  // Which handle the cursor is hovering (for the resize cursor), null otherwise.
  const [hoverHandle, setHoverHandle] = useState<ResizeHandle | null>(null);

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

  // Selection change: sync renderer's selectedLayerId, re-render so the overlay
  // appears / disappears immediately, AND report up so the timeline rows
  // highlight the same layer. The equality guard in the pull-down effect below
  // stops this from looping when the change originated from outside.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.selectedLayerId = selectedLayerId;
    void renderer.renderFrame(composition, currentFrame);
    onSelectLayer?.(selectedLayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  // Pull a selection made elsewhere (a timeline row click) into the canvas, so
  // clicking a layer in the list selects + outlines it on the canvas too.
  useEffect(() => {
    if (externalSelectedLayerId === undefined) return;
    setSelectedLayerId(prev => (prev === externalSelectedLayerId ? prev : externalSelectedLayerId));
  }, [externalSelectedLayerId]);

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
    // Scope the path + dot to the SLIDE under the playhead — the full-screen
    // image active at the current time — so the stream loops only on that slide
    // instead of spanning the whole composition (the old [0, duration] default).
    const t = currentFrame / (composition.fps || 30);
    const activeAt = (l: Layer) => {
      const s = l.startTime ?? 0;
      const e = s + (l.layerDuration ?? composition.duration);
      return t >= s && t < e;
    };
    const slide = [...composition.layers].reverse().find(
      (l) => l.type === 'image' && activeAt(l) && l.size.width >= composition.width * 0.9,
    );
    const winStart = +(slide ? (slide.startTime ?? 0) : Math.max(0, Math.min(t, composition.duration - 6))).toFixed(2);
    const winEnd = slide ? winStart + (slide.layerDuration ?? composition.duration) : Math.min(composition.duration, winStart + 6);
    const winDur = Math.max(0.5, +(winEnd - winStart).toFixed(2));

    // Default loop: a 0.8s traversal tiled across the window, so the dot streams
    // along the path and repeats instead of crawling once.
    const CYCLE = 0.8;
    const cycles: Array<{ start: number; end: number; pathLayerId: string }> = [];
    for (let c = 0; c < winDur - 1e-6; c += CYCLE) {
      cycles.push({ start: +c.toFixed(3), end: +Math.min(c + CYCLE, winDur).toFixed(3), pathLayerId: pathLayer.id });
    }

    const scopedPath: Layer = { ...pathLayer, startTime: winStart, layerDuration: winDur };
    const dotId = `layer-${Date.now().toString(36)}-dot`;
    const dotLayer: Layer = {
      id: dotId,
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { width: 14, height: 14 },
      startTime: winStart,
      layerDuration: winDur,
      properties: {
        shape: 'circle',
        color: '#38bdf8',           // sky-400 to match the editor accent
        opacity: 1,
        strokeColor: '#0c4a6e',     // sky-900
        strokeWidth: 2,
        motionScenes: cycles,
      },
    };
    onAddLayers([scopedPath, dotLayer]);
    setPenMode(false);
  }, [composition.duration, composition.fps, composition.width, composition.layers, currentFrame, onAddLayers, maskTargetId, onUpdateLayerMask]);

  // Patch-tool finish handler: the overlay emits the region outline + the source
  // offset in composition-pixel coords. Convert BOTH into the target image
  // layer's LOCAL 0..1 space (same contract as PathMask / ImagePatch) so the
  // patch travels + scales with the image, then append it via onAddPatch.
  const handlePatchFinish = useCallback((patch: { outline: PathAnchor[]; source: { x: number; y: number } }) => {
    const target = patchTargetId ? composition.layers.find((l) => l.id === patchTargetId) : null;
    if (onAddPatch && target && target.size.width > 0 && target.size.height > 0 && patch.outline.length >= 3) {
      const w = target.size.width;
      const h = target.size.height;
      const ox = target.position.x;
      const oy = target.position.y;
      const outline: PathAnchor[] = patch.outline.map((a) => ({
        x: (a.x - ox) / w,
        y: (a.y - oy) / h,
      }));
      onAddPatch(patchTargetId!, {
        outline,
        source: { dx: patch.source.x / w, dy: patch.source.y / h },
        feather: 6,
      });
    }
    setPatchTargetId(null);
  }, [patchTargetId, composition.layers, onAddPatch]);

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

    // Resize-handle grab takes priority over move/deselect. Only the selected
    // layer draws handles, so resizeHandleAt returns null unless one is under
    // the cursor. Shift (read live per move event) constrains the aspect ratio.
    const handle = rendererRef.current.resizeHandleAt(coords.x, coords.y, composition, time);
    if (handle && selectedLayerId) {
      const layer = composition.layers.find(l => l.id === selectedLayerId);
      if (layer) {
        e.preventDefault();
        const L0 = layer.position.x;
        const T0 = layer.position.y;
        const R0 = layer.position.x + layer.size.width;
        const B0 = layer.position.y + layer.size.height;
        resizingRef.current = {
          layerId: selectedLayerId, handle, L0, T0, R0, B0,
          finalX: L0, finalY: T0, finalW: layer.size.width, finalH: layer.size.height,
        };
        const onResizeMove = (ev: MouseEvent) => {
          const rs = resizingRef.current;
          if (!rs) return;
          const now = toCanvasCoords(ev.clientX, ev.clientY);
          if (!now) return;
          const box = computeResizedBox(rs.handle, rs.L0, rs.T0, rs.R0, rs.B0, now.x, now.y, ev.shiftKey);
          rs.finalX = box.x; rs.finalY = box.y; rs.finalW = box.w; rs.finalH = box.h;
          const renderer = rendererRef.current;
          if (!renderer) return;
          const tempComp: CompositionData = {
            ...composition,
            layers: composition.layers.map(l => l.id === rs.layerId
              ? { ...l, position: { x: box.x, y: box.y }, size: { width: box.w, height: box.h } }
              : l),
          };
          renderer.selectedLayerId = rs.layerId;
          void renderer.renderFrame(tempComp, currentFrame);
        };
        const onResizeUp = () => {
          const rs = resizingRef.current;
          resizingRef.current = null;
          document.removeEventListener('mousemove', onResizeMove);
          document.removeEventListener('mouseup', onResizeUp);
          if (!rs) return;
          const layerNow = composition.layers.find(l => l.id === rs.layerId);
          if (!layerNow) return;
          const x = Math.round(rs.finalX), y = Math.round(rs.finalY);
          const w = Math.round(rs.finalW), h = Math.round(rs.finalH);
          if (layerNow.position.x === x && layerNow.position.y === y
            && layerNow.size.width === w && layerNow.size.height === h) return;
          onLayerResize?.(rs.layerId, { x, y }, { width: w, height: h });
        };
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeUp);
        return;
      }
    }

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
  }, [editMode, composition, currentFrame, handlePanStart, onLayerMove, onLayerResize, selectedLayerId, toCanvasCoords, onUpdateGuides]);

  // Cursor feedback: in edit mode, show grab when hovering a layer.
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!editMode || !rendererRef.current || draggingRef.current || resizingRef.current) {
      if (hoverLayerId !== null) setHoverLayerId(null);
      if (hoverHandle !== null) setHoverHandle(null);
      return;
    }
    const coords = toCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;
    const time = currentFrame / composition.fps;
    // A handle hover wins over a body hover (resize cursor takes priority).
    const handle = rendererRef.current.resizeHandleAt(coords.x, coords.y, composition, time);
    if (handle !== hoverHandle) setHoverHandle(handle);
    const hitId = handle ? hoverLayerId : rendererRef.current.hitTest(coords.x, coords.y, composition, time);
    if (!handle && hitId !== hoverLayerId) setHoverLayerId(hitId);
  }, [editMode, composition, currentFrame, hoverLayerId, hoverHandle, toCanvasCoords]);

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
              cursor: resizingRef.current
                ? handleCursor(resizingRef.current.handle)
                : draggingRef.current
                ? 'grabbing'
                : editMode
                ? (hoverHandle ? handleCursor(hoverHandle) : hoverLayerId ? 'grab' : 'crosshair')
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
            {editMode && !penMode && !patchTargetId && onUpdatePathAnchors && (
              <PathEditOverlay
                composition={composition}
                currentTime={currentFrame / (composition.fps || 30)}
                selectedLayerId={selectedLayerId}
                onSelectPath={setSelectedLayerId}
                onUpdatePath={onUpdatePathAnchors}
              />
            )}
            {patchTargetId && (
              <PatchToolOverlay
                compositionWidth={composition.width}
                compositionHeight={composition.height}
                onFinish={handlePatchFinish}
                onCancel={() => setPatchTargetId(null)}
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
                  {hasMask && onSetMaskFeather && (() => {
                    const mask = (sel.properties as Record<string, unknown>).mask as { feather?: number } | undefined;
                    const featherVal = typeof mask?.feather === 'number' ? mask.feather : 0;
                    return (
                      <label
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 bg-slate-800 border border-slate-700"
                        title="Soften the mask edge (0 = hard edge)"
                      >
                        Feather
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={featherVal}
                          onChange={(e) => onSetMaskFeather(selectedLayerId, parseInt(e.target.value) || 0)}
                          className="w-24 accent-sky-500"
                        />
                        <span className="w-9 tabular-nums text-right">{featherVal}px</span>
                      </label>
                    );
                  })()}
                  {hasMask && onSetMaskInvert && (() => {
                    const mask = (sel.properties as Record<string, unknown>).mask as { invert?: boolean } | undefined;
                    const inverted = !!mask?.invert;
                    return (
                      <button
                        onClick={() => onSetMaskInvert(selectedLayerId, !inverted)}
                        className={[
                          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border',
                          inverted
                            ? 'bg-sky-600 hover:bg-sky-500 text-white border-sky-500'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
                        ].join(' ')}
                        title={inverted ? 'Mask is inverted — clipping OUTSIDE the outline (a hole). Click to keep inside.' : 'Invert the mask — clip OUTSIDE the outline (cut a hole) instead of keeping inside'}
                      >
                        <Scissors className="w-4 h-4" />
                        {inverted ? 'Inverted' : 'Invert'}
                      </button>
                    );
                  })()}
                </>
              );
            })()}
            {/* Patch (clone-stamp) — only for a selected IMAGE layer. Opens the
                two-phase patch tool: draw a region over a blemish/tag, then
                click a clean area to copy over it. */}
            {editMode && selectedLayerId && onAddPatch && (() => {
              const sel = composition.layers.find((l) => l.id === selectedLayerId);
              if (!sel || sel.type !== 'image') return null;
              const patches = (sel.properties as Record<string, unknown>).patches;
              const count = Array.isArray(patches) ? patches.length : 0;
              return (
                <>
                  <button
                    onClick={() => {
                      controllerRef.current?.pause();
                      setIsPlaying(false);
                      setPenMode(false);
                      setPatchTargetId(selectedLayerId);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                    title="Patch tool — cover a blemish/tag by cloning a clean part of the same image over it"
                  >
                    <Stamp className="w-4 h-4" />
                    {count > 0 ? 'Add patch' : 'Patch'}
                  </button>
                  {count > 0 && onClearPatches && (
                    <button
                      onClick={() => onClearPatches(selectedLayerId)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border bg-slate-800 hover:bg-rose-900/40 text-slate-200 border-slate-700 hover:border-rose-700"
                      title={`Remove all ${count} clone patch${count === 1 ? '' : 'es'} from this image`}
                    >
                      <Eraser className="w-4 h-4" />
                      Clear patches ({count})
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
