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
};

export type LayerGroup = {
  id: string;
  name: string;
  collapsed?: boolean;
  visible?: boolean;
};

export type Layer = {
  id: string;
  type: 'text' | 'shape' | 'image' | 'video' | 'kg-shape' | 'card' | 'math-shape' | 'audio';
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
   */
  kind?: 'layer' | 'char-stagger' | 'mask-wipe';
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
};

export type Keyframe = {
  time: number;
  value: unknown;
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
