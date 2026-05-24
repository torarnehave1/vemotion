export type CompositionData = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  fontFamily?: string;
  groups?: LayerGroup[];
  layers: Layer[];
};

export type LayerGroup = {
  id: string;
  name: string;
  collapsed?: boolean;
  visible?: boolean;
};

export type Layer = {
  id: string;
  type: 'text' | 'shape' | 'image' | 'video' | 'kg-shape' | 'card' | 'math-shape';
  groupId?: string;
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
  xFormula?: string;
  yFormula?: string;
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
