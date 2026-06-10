import React, { useState } from 'react';
import type { CompositionData, Layer } from '../lib/api';
import { Plus, Trash2, Download, Loader2, Sparkles, Eye, EyeOff, Maximize2, Copy, Image as ImageIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { AddLayerModal } from './AddLayerModal';
import { AnimationPortfolioModal } from './AnimationPortfolioModal';
import { RefitCompositionModal } from './RefitCompositionModal';
import { exportToMp4, type ExportProgress } from '../lib/exporter';
import { exportFramePng, captureFramePngBlob } from '../lib/screenshot';
import { uploadImageToAlbum, VEMOTION_ALBUM } from '../lib/photoAlbum';

const FONT_PRESETS = [
  { label: 'Inter — neutral default',        value: 'Inter' },
  { label: 'Poppins — friendly rounded',     value: 'Poppins' },
  { label: 'Caveat — hand-drawn (Excalidraw)', value: 'Caveat' },
  { label: 'Montserrat — bold headlines',    value: 'Montserrat' },
  { label: 'DM Sans — minimal',              value: 'DM Sans' },
  { label: 'Plus Jakarta Sans — techy',      value: 'Plus Jakarta Sans' },
  { label: 'Space Grotesk — geometric',      value: 'Space Grotesk' },
] as const;

const SIZE_PRESETS = [
  { label: 'YouTube / Landscape HD — 1920×1080', w: 1920, h: 1080 },
  { label: 'YouTube Short / Reels / TikTok — 1080×1920', w: 1080, h: 1920 },
  { label: 'Instagram Square — 1080×1080', w: 1080, h: 1080 },
  { label: 'Instagram Landscape — 1280×720', w: 1280, h: 720 },
  { label: 'Custom', w: 0, h: 0 },
] as const;

interface CompositionEditorProps {
  composition: CompositionData;
  onChange: (c: CompositionData) => void;
  /** Playhead position, so "Export PNG" captures the frame on screen, not frame 0. */
  currentFrame?: number;
}

export const CompositionEditor: React.FC<CompositionEditorProps> = ({ composition, onChange, currentFrame = 0 }) => {
  const [showModal, setShowModal] = useState(false);
  const [showAnimModal, setShowAnimModal] = useState(false);
  const [showRefitModal, setShowRefitModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const set = (patch: Partial<CompositionData>) => onChange({ ...composition, ...patch });

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress(null);
    try {
      await exportToMp4(composition, (p) => setExportProgress(p));
    } catch (err) {
      console.error('Export failed:', err);
      setExportProgress({ stage: 'done', percent: 0, message: 'Export failed. See console for details.' });
    } finally {
      setExporting(false);
    }
  };

  const [exportingPng, setExportingPng] = useState(false);
  const handleExportPng = async () => {
    if (exportingPng) return;
    setExportingPng(true);
    try {
      await exportFramePng(composition, Math.max(0, Math.round(currentFrame)));
    } catch (err) {
      console.error('PNG export failed:', err);
    } finally {
      setExportingPng(false);
    }
  };

  const [savingPng, setSavingPng] = useState(false);
  const [pngAlbumUrl, setPngAlbumUrl] = useState<string | null>(null);
  const [pngAlbumError, setPngAlbumError] = useState<string | null>(null);
  const handleSavePngToAlbum = async () => {
    if (savingPng) return;
    setSavingPng(true);
    setPngAlbumUrl(null);
    setPngAlbumError(null);
    try {
      const frame = Math.max(0, Math.round(currentFrame));
      const blob = await captureFramePngBlob(composition, frame);
      const file = new File([blob], `vemotion-frame-${frame}.png`, { type: 'image/png' });
      const url = await uploadImageToAlbum(file);
      setPngAlbumUrl(url);
    } catch (err) {
      console.error('Save PNG to album failed:', err);
      setPngAlbumError('Save failed. See console.');
    } finally {
      setSavingPng(false);
    }
  };

  const addLayer = (layer: Layer) => {
    onChange({ ...composition, layers: [...composition.layers, layer] });
  };

  const addLayers = (layers: Layer[]) => {
    onChange({ ...composition, layers: [...composition.layers, ...layers] });
  };

  const removeLayer = (id: string) => {
    onChange({ ...composition, layers: composition.layers.filter(l => l.id !== id) });
  };

  /**
   * Duplicate a layer. Insert the copy immediately AFTER the original so the
   * duplicate sits on top in z-order (Figma / Keynote convention). Offset by
   * (+20, +20) px so the user can see it's a separate layer instead of
   * stacked invisibly on the source. New unique id via the same timestamp
   * pattern AddLayerModal uses for new-layer creation.
   */
  const duplicateLayer = (id: string) => {
    const idx = composition.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const source = composition.layers[idx];
    // Deep clone — animations, properties (including motionScenes), keyframes,
    // and nested objects all get their own references so editing the copy
    // doesn't mutate the source.
    const clone: Layer = JSON.parse(JSON.stringify(source));
    clone.id = `layer-${Date.now().toString(36)}`;
    clone.position = { x: source.position.x + 20, y: source.position.y + 20 };
    const layers = [
      ...composition.layers.slice(0, idx + 1),
      clone,
      ...composition.layers.slice(idx + 1),
    ];
    onChange({ ...composition, layers });
  };

  const toggleLayerVisibility = (id: string) => {
    onChange({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === id ? { ...layer, visible: layer.visible === false ? true : false } : layer
      ),
    });
  };

  // Reorder = z-order. Layers draw in array order: LATER in the array (lower in
  // this list) draws ON TOP. 'up' moves a layer one slot earlier (further back);
  // 'down' moves it one slot later (more on top). No-op at the ends.
  const moveLayer = (id: string, dir: 'up' | 'down') => {
    const idx = composition.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= composition.layers.length) return;
    const layers = [...composition.layers];
    [layers[idx], layers[target]] = [layers[target], layers[idx]];
    onChange({ ...composition, layers });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
      <h2 className="text-lg font-semibold text-white">Composition Editor</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Duration (seconds)</label>
          <input
            type="number"
            value={composition.duration}
            min={1}
            max={300}
            onChange={(e) => set({ duration: parseFloat(e.target.value) })}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">FPS</label>
          <select
            value={composition.fps}
            onChange={(e) => set({ fps: parseInt(e.target.value) })}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Canvas size</label>
          <select
            value={SIZE_PRESETS.find(p => p.w === composition.width && p.h === composition.height)?.label ?? 'Custom'}
            onChange={(e) => {
              const preset = SIZE_PRESETS.find(p => p.label === e.target.value);
              if (preset && preset.w !== 0) set({ width: preset.w, height: preset.h });
            }}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {SIZE_PRESETS.map(p => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Default font</label>
          <select
            value={composition.fontFamily ?? 'Inter'}
            onChange={(e) => set({ fontFamily: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
            style={{ fontFamily: composition.fontFamily ?? 'Inter' }}
          >
            {FONT_PRESETS.map(f => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Width (px)</label>
            <input
              type="number"
              value={composition.width}
              min={100}
              max={3840}
              onChange={(e) => set({ width: parseInt(e.target.value) || composition.width })}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Height (px)</label>
            <input
              type="number"
              value={composition.height}
              min={100}
              max={3840}
              onChange={(e) => set({ height: parseInt(e.target.value) || composition.height })}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        {/*
          Refit — opens a dialog to scale all layers to a new canvas size.
          Distinct from the size dropdown above (which only changes width/height
          without touching layers). Use this when reformatting an existing
          composition for another aspect (e.g. landscape → Instagram Square).
        */}
        <button
          onClick={() => setShowRefitModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm rounded-lg transition"
          title="Scale all layers to a new canvas size"
        >
          <Maximize2 className="w-4 h-4" />
          Refit layers to canvas…
        </button>
      </div>

      {/* Layers */}
      <div className="pt-4 border-t border-slate-800 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Layers</h3>

        {composition.layers.map((layer, idx) => (
          <div
            key={layer.id}
            className={[
              'bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2 transition',
              layer.visible === false && 'opacity-60',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={layer.name ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  const layers = composition.layers.map(l =>
                    l.id === layer.id
                      ? { ...l, name: value.trim() ? value : undefined }
                      : l
                  );
                  onChange({ ...composition, layers });
                }}
                placeholder={layer.id}
                title="Rename this layer"
                className="flex-1 min-w-0 bg-transparent hover:bg-slate-700/50 focus:bg-slate-700 text-sm font-medium text-white rounded px-1.5 py-0.5 border border-transparent focus:border-sky-500 focus:outline-none placeholder:text-slate-400 placeholder:font-normal transition"
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{layer.type}</span>
                <button
                  onClick={() => moveLayer(layer.id, 'up')}
                  disabled={idx === 0}
                  className="text-slate-500 hover:text-sky-400 disabled:opacity-30 disabled:hover:text-slate-500 transition"
                  title="Move back (render behind the layer above)"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => moveLayer(layer.id, 'down')}
                  disabled={idx === composition.layers.length - 1}
                  className="text-slate-500 hover:text-sky-400 disabled:opacity-30 disabled:hover:text-slate-500 transition"
                  title="Move forward (render on top of the layer below)"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => toggleLayerVisibility(layer.id)}
                  className="text-slate-500 hover:text-sky-400 transition"
                  title={layer.visible === false ? 'Show layer' : 'Hide layer'}
                >
                  {layer.visible === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => duplicateLayer(layer.id)}
                  className="text-slate-500 hover:text-emerald-400 transition"
                  title="Duplicate layer (insert copy right after, offset +20, +20)"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => removeLayer(layer.id)} className="text-slate-500 hover:text-red-400 transition" title="Delete layer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {layer.type === 'text' && (
              <input
                type="text"
                value={(layer.properties.text as string) ?? ''}
                onChange={(e) => {
                  const layers = composition.layers.map(l =>
                    l.id === layer.id
                      ? { ...l, properties: { ...l.properties, text: e.target.value } }
                      : l
                  );
                  onChange({ ...composition, layers });
                }}
                placeholder="Layer text"
                className="w-full bg-slate-700 border border-slate-600 text-white text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            )}

            {layer.animation && (
              <p className="text-xs text-slate-500">
                Animates: <span className="text-sky-400">{layer.animation.property}</span>
                {Array.isArray(layer.animation.keyframes) && ` — ${layer.animation.keyframes.length} keyframes`}
              </p>
            )}
          </div>
        ))}

        <button
          onClick={() => setShowModal(true)}
          className="w-full border border-dashed border-slate-700 hover:border-sky-500 text-slate-400 hover:text-sky-400 font-medium rounded-lg py-2 flex items-center justify-center gap-2 transition text-sm">
          <Plus className="w-4 h-4" />
          Add Layer
        </button>

        <button
          onClick={() => setShowAnimModal(true)}
          className="w-full border border-dashed border-slate-700 hover:border-sky-500 text-slate-400 hover:text-sky-400 font-medium rounded-lg py-2 flex items-center justify-center gap-2 transition text-sm">
          <Sparkles className="w-4 h-4" />
          Add Animation
        </button>

        {showModal && (
          <AddLayerModal
            onAdd={addLayer}
            onUpdateMeta={(patch) => {
              // Merge the audio amp track into composition.meta. Used by
              // AudioLayerForm after Web-Audio analysis completes — drives
              // the renderer's amp / ampL / ampR formula context variables.
              onChange({
                ...composition,
                meta: { ...composition.meta, ...patch },
              });
            }}
            onClose={() => setShowModal(false)}
            compositionDuration={composition.duration}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
          />
        )}

        {showAnimModal && (
          <AnimationPortfolioModal
            onAddLayers={addLayers}
            onClose={() => setShowAnimModal(false)}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
          />
        )}

        {showRefitModal && (
          <RefitCompositionModal
            composition={composition}
            onApply={(next) => onChange(next)}
            onClose={() => setShowRefitModal(false)}
          />
        )}
      </div>

      {exportProgress && (
        <div className="space-y-1">
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${exportProgress.percent}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 text-center">{exportProgress.message}</p>
        </div>
      )}

      <button
        onClick={handleExport}
        disabled={exporting}
        className="w-full bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg py-3 transition flex items-center justify-center gap-2"
      >
        {exporting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> {exportProgress?.message ?? 'Preparing...'}</>
          : <><Download className="w-4 h-4" /> Export MP4</>
        }
      </button>

      <button
        onClick={handleExportPng}
        disabled={exportingPng}
        className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-700 disabled:text-slate-500 text-slate-200 border border-slate-700 font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-2"
      >
        {exportingPng
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
          : <><ImageIcon className="w-4 h-4" /> Export PNG (screenshot)</>
        }
      </button>

      <button
        onClick={handleSavePngToAlbum}
        disabled={savingPng}
        className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-700 disabled:text-slate-500 text-slate-200 border border-slate-700 font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-2"
        title={`Save the current frame to your "${VEMOTION_ALBUM}" photo album`}
      >
        {savingPng
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving to album…</>
          : <><ImageIcon className="w-4 h-4" /> Save PNG to {VEMOTION_ALBUM} album</>
        }
      </button>
      {pngAlbumUrl && (
        <p className="text-xs text-emerald-400">
          Saved to {VEMOTION_ALBUM}.{' '}
          <a href={pngAlbumUrl} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300">View image</a>
        </p>
      )}
      {pngAlbumError && <p className="text-xs text-red-400">{pngAlbumError}</p>}
    </div>
  );
};
