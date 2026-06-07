import React, { useRef, useState } from 'react';
import { Upload, Loader2, Link2, Film } from 'lucide-react';
import type { Layer } from '../lib/api';
import { uploadVideoFile } from '../lib/videoUpload';

interface VideoLayerFormProps {
  onAdd: (layer: Layer) => void;
  compositionWidth: number;
  compositionHeight: number;
  compositionDuration: number;
  editingLayer?: Layer;
}

type Mode = 'upload' | 'url';
type Fit = 'cover' | 'contain' | 'fill';

const generateId = () => `layer-${Date.now().toString(36)}`;

/**
 * Video-tab content for AddLayerModal.
 *
 * Source is either an uploaded file (pushed to R2 via the transcription
 * worker, same binary→R2 path the audio layer uses) or a pasted direct URL.
 * The chosen source becomes a `type: 'video'` layer. The renderer draws the
 * video frame onto the canvas each tick, so the layer shows in preview,
 * respects z-order, and bakes into the MP4 export. The video's own audio is
 * not muxed — add a separate audio layer for sound.
 */
export const VideoLayerForm: React.FC<VideoLayerFormProps> = ({
  onAdd,
  compositionWidth,
  compositionHeight,
  compositionDuration,
  editingLayer,
}) => {
  const [mode, setMode] = useState<Mode>('upload');
  const [src, setSrc] = useState<string>((editingLayer?.properties.src as string) ?? '');
  const [name, setName] = useState<string>((editingLayer?.properties.name as string) ?? '');
  const [urlInput, setUrlInput] = useState('');
  const [fit, setFit] = useState<Fit>(((editingLayer?.properties.fit as Fit) ?? 'cover'));
  const [startTime, setStartTime] = useState<number>(editingLayer?.startTime ?? 0);
  const [layerDuration, setLayerDuration] = useState<number>(editingLayer?.layerDuration ?? compositionDuration);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Probe a video URL for its intrinsic dimensions + duration so the layer is
  // sized to the source aspect ratio (clamped to the canvas) and its window
  // autofills to the clip length. Resolves with fallbacks on any error.
  const probe = (url: string): Promise<{ w: number; h: number; duration: number }> =>
    new Promise((resolve) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.preload = 'metadata';
      v.onloadedmetadata = () =>
        resolve({ w: v.videoWidth || 0, h: v.videoHeight || 0, duration: v.duration || 0 });
      v.onerror = () => resolve({ w: 0, h: 0, duration: 0 });
      v.src = url;
    });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const { url } = await uploadVideoFile(file);
      setSrc(url);
      setName(file.name);
    } catch {
      setError('Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const useUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setSrc(trimmed);
    if (!name) {
      const last = trimmed.split('/').pop() ?? 'video';
      setName(decodeURIComponent(last.split('?')[0]) || 'video');
    }
  };

  const handleAdd = async () => {
    if (!src) return;
    const { w: nw, h: nh, duration } = await probe(src);

    // Size: preserve aspect ratio, clamp to canvas. Fallback to half-canvas.
    let w: number;
    let h: number;
    if (nw > 0 && nh > 0) {
      const scale = Math.min(nw > compositionWidth ? compositionWidth / nw : 1,
                             nh > compositionHeight ? compositionHeight / nh : 1);
      w = Math.round(nw * scale);
      h = Math.round(nh * scale);
    } else {
      w = Math.round(compositionWidth / 2);
      h = Math.round(compositionHeight / 2);
    }
    const x = Math.round((compositionWidth - w) / 2);
    const y = Math.round((compositionHeight - h) / 2);

    // Autofill the layer window to the clip length the first time (only when
    // it still equals the composition default), clamped to the composition.
    let dur = layerDuration;
    if (duration > 0 && layerDuration === compositionDuration) {
      dur = Math.min(duration, compositionDuration - startTime);
    }

    const layer: Layer = {
      id: editingLayer?.id ?? generateId(),
      type: 'video',
      position: editingLayer?.position ?? { x, y },
      size: editingLayer?.size ?? { width: w, height: h },
      startTime,
      layerDuration: dur,
      ...(editingLayer?.animation ? { animation: editingLayer.animation } : {}),
      ...(editingLayer?.animations ? { animations: editingLayer.animations } : {}),
      properties: {
        ...(editingLayer?.properties ?? {}),
        src,
        fit,
        name: name || 'video',
      },
    };
    onAdd(layer);
  };

  return (
    <div className="space-y-4">
      {/* Source mode */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('upload')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            mode === 'upload' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <Upload className="w-4 h-4" /> Upload
        </button>
        <button
          onClick={() => setMode('url')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            mode === 'url' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <Link2 className="w-4 h-4" /> URL
        </button>
      </div>

      {mode === 'upload' ? (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleUpload}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition"
            >
              <Upload className="w-4 h-4" /> Choose video file
            </button>
            {uploading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <p className="text-xs text-slate-500">Uploaded to your R2 store. MP4 / WebM work best.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://…/clip.mp4"
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
            <button
              onClick={useUrl}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition"
            >
              Use
            </button>
          </div>
          <p className="text-xs text-slate-500">A direct video URL. Must allow cross-origin access to export.</p>
        </div>
      )}

      {/* Selected source preview */}
      {src && (
        <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Film className="w-4 h-4 text-sky-400" />
            <span className="truncate">{name || src}</span>
          </div>
          <video src={src} controls muted className="w-full max-h-48 rounded bg-black" />

          {/* Fit */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">Fit</label>
            <select
              value={fit}
              onChange={(e) => setFit(e.target.value as Fit)}
              className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-sky-500"
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="fill">Fill</option>
            </select>
          </div>

          {/* Timing */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">Start (s)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={startTime}
              onChange={(e) => setStartTime(Math.max(0, Number(e.target.value) || 0))}
              className="w-24 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">Length (s)</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={layerDuration}
              onChange={(e) => setLayerDuration(Math.max(0.1, Number(e.target.value) || 0.1))}
              className="w-24 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={handleAdd}
        disabled={!src}
        className="w-full px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition"
      >
        {editingLayer ? 'Save video layer' : 'Add video layer'}
      </button>
    </div>
  );
};
