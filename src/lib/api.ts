export type CompositionData = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  layers: Layer[];
};

export type Layer = {
  id: string;
  type: 'text' | 'shape' | 'image' | 'video';
  position: { x: number; y: number };
  size: { width: number; height: number };
  startTime?: number;
  layerDuration?: number;
  animation?: Animation;
  properties: Record<string, unknown>;
};

export type Animation = {
  property: string;
  keyframes: Keyframe[];
  easing?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';
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
