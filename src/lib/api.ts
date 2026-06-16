export type CompositionData = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  fontFamily?: string;
  groups?: LayerGroup[];
  layers: Layer[];
  /**
   * Optional prose metadata for the composition. Lets the author (often an
   * AI agent or another tool) bake intent + context into the composition
   * itself so a future agent reading the JSON doesn't need an out-of-band
   * explanation of what the composition does. Preserved round-trip through
   * autosave; no editor UI in v1 — agents read/write directly.
   */
  meta?: CompositionMeta;
};

export type CompositionMeta = {
  /**
   * One paragraph explaining what the composition is and what it animates.
   * Convention: write it the way you would explain the composition to a
   * fresh AI agent that has never seen it before. Include what it depicts,
   * what moves, what the purpose is, and any non-obvious authoring choices
   * (e.g. "circles intentionally overlap to suggest Venn-style intersection").
   */
  description?: string;
  /**
   * Free-form labels for cross-cutting concerns — "animation", "title-card",
   * "demo", "client-x", "draft". Used by the Portfolio modal as filter chips.
   * Convention: lowercase, hyphen-separated, no leading #.
   */
  tags?: string[];
  /**
   * Single free-form classification — "Title cards", "Lyric videos",
   * "Explainers", "Demos". Used by the Portfolio modal as a sidebar filter.
   * Convention: human-friendly capitalised noun phrase.
   */
  category?: string;
  /**
   * Single free-form area / domain — "Marketing", "Education", "Research".
   * Used by the Portfolio modal as a sidebar filter (separate axis from
   * category). Convention: human-friendly capitalised noun.
   */
  metaArea?: string;
  /**
   * Stable pointer to the composition's project graph (a Knowledge Graph id,
   * UUID v4). Set when the composition is filed into a project chapter. This
   * is the authoritative project-membership link — independent of metaArea,
   * so naming a project after an existing metaArea does NOT sweep in unrelated
   * compositions, and renaming a project (its metaArea) does not detach
   * members. Chapter placement itself lives in the project graph (a compref
   * node under a chapter), not on the composition. See lib/project-graphs.ts.
   */
  projectGraphId?: string;
  /**
   * Pre-baked amplitude track for audio-reactive layer formulas.
   * Produced client-side from the composition's first audio layer when added
   * via AudioLayerForm (or constructed manually for smoke testing). Three
   * parallel channels — left, right, mono — sampled at the same fixed rate
   * (typically 30 Hz to match the composition's default fps).
   *
   * Each value is normalized so that the peak across all three channels
   * equals 1.0. Linear interpolation between adjacent samples is the
   * renderer's lookup convention.
   *
   * Exposes three context variables in math-shape xFormula / yFormula and
   * in motionScene formulas: `amp` (mono mix), `ampL`, `ampR`. Sampled at
   * absolute composition time, not layer-local time — so amp is the same
   * value across every layer at any given moment.
   *
   * v1 limitation: one audioTrack per composition. If multiple audio
   * layers exist, only the first one drives the track.
   */
  audioTrack?: AudioTrack;
  /**
   * Illustrator-style ruler guides. Editor-only: the renderer draws them
   * (cyan lines) only when `showGuides` is set, which VideoPreview enables
   * and the exporter never does — so MP4 output stays guide-free. Layers
   * snap their centre to these positions while dragging in edit mode.
   * Positions are in composition-pixel space (same coordinate space as
   * layer.position), NOT screen space.
   */
  guides?: Guide[];
  /**
   * Named time markers on the timeline. Editor-only: the renderer and the MP4
   * exporter ignore them entirely — they never affect output. Their purpose is
   * communication: annotate exact timeline positions so a human or an AI agent
   * reading this JSON knows precisely where a change is wanted (e.g.
   * { time: 39, label: "swap the headline copy here" }). Shown as flags on the
   * timeline ruler. `time` is in SECONDS, absolute composition time — the same
   * units and origin as `layer.startTime`.
   */
  markers?: TimelineMarker[];
};

export type TimelineMarker = {
  id: string;
  /** Absolute composition time in seconds (same units as layer.startTime). */
  time: number;
  /** Human/agent-facing note describing what should happen at this time. */
  label: string;
};

export type Guide = {
  id: string;
  /**
   * 'x' = a vertical line at x=position (dragged from the left ruler).
   * 'y' = a horizontal line at y=position (dragged from the top ruler).
   */
  axis: 'x' | 'y';
  /** Composition-pixel coordinate of the line on its axis. */
  position: number;
};

export type AudioTrack = {
  /** Samples per second. Typically 30 to match the composition fps. */
  sampleRate: number;
  /** Length of the audio in seconds. Used for bounds checking. */
  duration: number;
  /** Left channel amplitudes, normalized 0..1, length = ceil(duration * sampleRate). */
  left: number[];
  /** Right channel amplitudes, normalized 0..1, same length as left. */
  right: number[];
  /** Mono (mix) amplitudes, normalized 0..1, same length as left. */
  mono: number[];
};

export type LayerGroup = {
  id: string;
  name: string;
  collapsed?: boolean;
  visible?: boolean;
};

export type Layer = {
  id: string;
  type: 'text' | 'shape' | 'image' | 'video' | 'kg-shape' | 'card' | 'math-shape' | 'audio' | 'path' | 'knitting-chart' | 'telemetry-track';
  /**
   * Optional human-readable label shown in the timeline + layer list instead of
   * the generated `id`. Display-only; the renderer never reads it. Resolve a
   * layer's label via `layerLabel()` (fallback chain: name → text/filename → id).
   */
  name?: string;
  groupId?: string;
  /**
   * Required for visual layer types. For 'audio' layers position/size are
   * still in the JSON (so the schema stays uniform and refit doesn't crash)
   * but are unused by the renderer — audio is sound, not pixels.
   */
  position: { x: number; y: number };
  size: { width: number; height: number };
  visible?: boolean;
  startTime?: number;
  layerDuration?: number;
  animation?: Animation;
  animations?: Animation[];
  properties: Record<string, unknown>;
};

/**
 * Resolve the display label for a layer. Priority:
 *   1. explicit `layer.name` (user-set rename)
 *   2. a sensible per-type fallback so layers are recognizable without a custom
 *      name — text layers show their text; media (image/video/audio) show the
 *      source filename from `properties.name`.
 *   3. the generated `layer.id` as a last resort.
 */
export function layerLabel(layer: Layer): string {
  const explicit = typeof layer.name === 'string' ? layer.name.trim() : '';
  if (explicit) return explicit;
  const props = layer.properties || {};
  if (layer.type === 'text' && typeof props.text === 'string' && props.text.trim()) {
    return (props.text as string).trim();
  }
  if (typeof props.name === 'string' && props.name.trim()) {
    return (props.name as string).trim();
  }
  return layer.id;
}

export type Animation = {
  /**
   * Discriminates how the animation is applied:
   * - 'layer' (default, also assumed when absent for backward compat): the
   *   resolved keyframe value replaces the named property on the whole layer.
   * - 'char-stagger': only valid on text layers. The renderer splits the
   *   layer's `properties.text` into characters at draw time and applies the
   *   keyframes per-character with an offset of `index * stagger` seconds.
   *   `stagger` is required when `kind === 'char-stagger'`.
   * - 'mask-wipe': renderer applies an animated clip path to the whole layer
   *   before drawing. `direction` controls the wipe geometry; `keyframes`
   *   drive a 0..1 reveal progress. `property` is unused for this kind.
   * - 'pixel-reveal': only valid on `knitting-chart` layers. `keyframes` drive
   *   a 0..1 progress; the renderer reveals the first `floor(progress × N)`
   *   painted cells in the layer's `properties.drawOrder` (the recorded paint
   *   sequence), drawing the rest as background — a pixel-by-pixel "drawing".
   *   `property` is unused for this kind.
   */
  kind?: 'layer' | 'char-stagger' | 'mask-wipe' | 'pixel-reveal';
  /** Layer property name to animate. Required for kind 'layer' and 'char-stagger'; unused for 'mask-wipe'. */
  property?: string;
  keyframes: Keyframe[];
  easing?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';
  /** Seconds of delay between successive characters. Used only when kind === 'char-stagger'. */
  stagger?: number;
  /** Wipe direction. Required when kind === 'mask-wipe'. */
  direction?: 'ltr' | 'rtl' | 'ttb' | 'btt' | 'radial';
};

export type MotionScene = {
  start: number;
  end: number;
  /** Returns absolute canvas X. Same evaluator vocabulary as scaleFormula. */
  xFormula?: string;
  /** Returns absolute canvas Y. */
  yFormula?: string;
  /**
   * Optional. Returns the layer's scale (1 = native size). When present
   * and the time is inside [start, end], OVERRIDES any other scale source
   * (static property, keyframe animation) for the duration of the scene —
   * same convention as xFormula/yFormula override position.
   * Same evaluator context as xFormula/yFormula (t, p, x0, y0, w, h,
   * sin, cos, pi, …). Pulse two times per scene: '1 + 0.5 * sin(p*4*pi)'.
   */
  scaleFormula?: string;
  /**
   * Optional. Reference a `type: 'path'` layer by id. During the scene
   * window, the layer's visual position is sampled from the path at
   * parameter p (0..1 across the scene). Mutually exclusive with
   * xFormula/yFormula in practice — when both are present, pathLayerId
   * takes precedence (it's the more specific intent).
   */
  pathLayerId?: string;
};

export type Keyframe = {
  time: number;
  value: unknown;
};

/**
 * Anchor in a `type: 'path'` layer's `properties.anchors` array.
 * Anchors carry their position plus optional Bezier control handles.
 *
 * - No `in` / `out` handles → the anchor is a CORNER. Segments meeting at
 *   it render as straight lines.
 * - Both adjacent anchors of a segment have `out` (on the prior anchor) +
 *   `in` (on the next anchor) → that segment renders as a cubic Bezier
 *   curve via ctx.bezierCurveTo. Mixing corner + smooth anchors is fine.
 *
 * Handles are RELATIVE offsets from the anchor's (x, y) — same convention
 * SVG paths use after normalising. Lets you drag the anchor without
 * recomputing the handles.
 */
export type PathAnchor = {
  x: number;
  y: number;
  /** Incoming handle offset relative to (x, y). */
  in?: { x: number; y: number };
  /** Outgoing handle offset relative to (x, y). */
  out?: { x: number; y: number };
};

/**
 * Optional clip mask on an `image` layer (`properties.mask`). When present the
 * image is clipped to this closed outline — everything outside the outline is
 * transparent. Lets a single image read as a cut-out shape in a collage.
 *
 * Coordinate space: LOCAL to the layer box (the architect-approved choice).
 * Anchor `x`/`y` are FRACTIONS in 0..1 of the layer's current width/height —
 * `(0,0)` is the layer's top-left, `(1,1)` its bottom-right. The renderer maps
 * them to canvas pixels from the layer's live `position` + `size` each frame, so
 * the mask travels and scales WITH the image when it's moved, resized, or scaled
 * by an animation. Bezier handles (`in`/`out`, inherited from PathAnchor) are
 * fractional offsets in the same 0..1 space.
 *
 * A mask is always a CLOSED region (the renderer closes it implicitly); needs
 * at least 3 anchors to enclose area.
 */
export type PathMask = {
  type: 'path';
  /** Closed outline in local 0..1 space. >= 3 anchors to enclose a region. */
  anchors: PathAnchor[];
  /**
   * When true, clip OUTSIDE the outline instead of inside — the shape becomes a
   * hole and the rest of the image is kept. Honored by the renderer (even-odd
   * fill with the layer rect). Absent/false = keep inside (default).
   */
  invert?: boolean;
  /**
   * Soft-edge width in pixels. Absent or 0 = hard edge (a plain clip). When > 0
   * the renderer feathers the mask edge by that blur radius via an offscreen
   * alpha mask. Per-mask + opt-in — default behaviour is unchanged.
   */
  feather?: number;
};

/**
 * A clone/heal patch on an `image` layer (`properties.patches[]`). Covers an
 * unwanted region of the image (a blemish, a tag, a watermark) by copying clean
 * pixels from a nearby part of the SAME image over it — the canvas equivalent of
 * a clone-stamp. The image carries its own repairs; nothing is baked into the
 * source file, so a patch is fully reversible by deleting it.
 *
 * Coordinate space: LOCAL to the layer box, identical to PathMask. `outline`
 * anchors are FRACTIONS 0..1 of the layer's current width/height; the renderer
 * maps them to pixels from the layer's live `position` + `size` each frame, so a
 * patch travels and scales WITH the image.
 *
 * Render: clip to `outline` (the region to repair), then redraw the same image
 * shifted by `-source`, so the texture at `outline + source` lands over the
 * region. The outline must enclose area (>= 3 anchors).
 */
export type ImagePatch = {
  /** Closed region to repair, in local 0..1 space. >= 3 anchors. */
  outline: PathAnchor[];
  /**
   * Offset (local 0..1, fractions of the layer box) from the repair region to
   * the clean texture copied into it. `(0.1, 0)` pulls source from 10% of the
   * layer width to the right; `(0, -0.05)` from just above. Drawn as a -source
   * translation of the image under the outline clip.
   */
  source: { dx: number; dy: number };
  /**
   * Soft blend width in pixels for the patch edge. Absent or 0 = hard edge.
   * When > 0 the renderer feathers the patch via an offscreen alpha mask, the
   * same path PathMask.feather uses — so the clone blends into surrounding pixels.
   */
  feather?: number;
};

export const api = {
  async createVideo(composition: CompositionData) {
    const res = await fetch('/api/video/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(composition),
    });
    if (!res.ok) throw new Error('Failed to create video');
    return res.json();
  },

  async getVideoStatus(videoId: string) {
    const res = await fetch(`/api/video/${videoId}/status`);
    if (!res.ok) throw new Error('Failed to fetch video status');
    return res.json();
  },

  async getVideoDownloadUrl(videoId: string) {
    const res = await fetch(`/api/video/${videoId}/download`);
    if (!res.ok) throw new Error('Failed to get download URL');
    return res.json();
  },

  async listTemplates() {
    const res = await fetch('/api/templates');
    if (!res.ok) throw new Error('Failed to fetch templates');
    return res.json();
  },

  async getTemplate(templateId: string) {
    const res = await fetch(`/api/templates/${templateId}`);
    if (!res.ok) throw new Error('Failed to fetch template');
    return res.json();
  },
};
