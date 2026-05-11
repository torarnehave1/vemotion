import React, { useState } from 'react';
import type { CompositionData, Layer } from '../lib/api';
import { Plus, Trash2, Download, Loader2 } from 'lucide-react';
import { AddLayerModal } from './AddLayerModal';
import { exportToMp4, type ExportProgress } from '../lib/exporter';

interface CompositionEditorProps {
  composition: CompositionData;
  onChange: (c: CompositionData) => void;
}

export const CompositionEditor: React.FC<CompositionEditorProps> = ({ composition, onChange }) => {
  const [showModal, setShowModal] = useState(false);
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

  const addLayer = (layer: Layer) => {
    onChange({ ...composition, layers: [...composition.layers, layer] });
  };

  const removeLayer = (id: string) => {
    onChange({ ...composition, layers: composition.layers.filter(l => l.id !== id) });
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Width</label>
            <select
              value={composition.width}
              onChange={(e) => set({ width: parseInt(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value={1280}>1280</option>
              <option value={1920}>1920</option>
              <option value={1080}>1080</option>
              <option value={720}>720</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Height</label>
            <select
              value={composition.height}
              onChange={(e) => set({ height: parseInt(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value={720}>720</option>
              <option value={1080}>1080</option>
              <option value={1920}>1920</option>
            </select>
          </div>
        </div>
      </div>

      {/* Layers */}
      <div className="pt-4 border-t border-slate-800 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Layers</h3>

        {composition.layers.map((layer) => (
          <div key={layer.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">{layer.id}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{layer.type}</span>
                <button onClick={() => removeLayer(layer.id)} className="text-slate-500 hover:text-red-400 transition">
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
                Animates: <span className="text-sky-400">{layer.animation.property}</span> — {layer.animation.keyframes.length} keyframes
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

        {showModal && (
          <AddLayerModal
            onAdd={addLayer}
            onClose={() => setShowModal(false)}
            compositionDuration={composition.duration}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
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
    </div>
  );
};
