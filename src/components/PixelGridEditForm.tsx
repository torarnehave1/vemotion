import React, { useEffect, useRef, useState } from 'react';
import type { Layer } from '../lib/api';
import { renderKnittingChart, type KnittingChart } from '../lib/knitting';

interface PixelGridEditFormProps {
  editingLayer: Layer;
  compositionDuration: number;
  onAdd: (layer: Layer) => void;
}

/**
 * Edit form for an existing `knitting-chart` (pixel-grid) layer. The grid's
 * cells are indices into `palette`, so editing a palette colour recolours
 * every pixel that uses it — no per-cell rewrite needed. Also exposes the
 * common box/timing/opacity settings and the display toggles, with a live
 * preview. Save spreads `...editingLayer` so `cells`, `cols`, `rows` and any
 * other property are preserved (Lesson 21).
 */
export const PixelGridEditForm: React.FC<PixelGridEditFormProps> = ({
  editingLayer,
  compositionDuration,
  onAdd,
}) => {
  const props = editingLayer.properties;
  const cols = Number(props.cols) || 0;
  const rows = Number(props.rows) || 0;
  const cells = Array.isArray(props.cells) ? (props.cells as string[]) : [];
  const background = (props.background as string) || '#ffffff';
  const gridColor = (props.gridColor as string) || '#999999';

  const [palette, setPalette] = useState<string[]>(
    Array.isArray(props.palette) ? (props.palette as string[]).slice() : []
  );
  const [showGrid, setShowGrid] = useState(props.showGrid !== false);
  const [showNumbers, setShowNumbers] = useState(props.showNumbers !== false);
  const [showLegend, setShowLegend] = useState(props.showLegend !== false);

  const [posX, setPosX] = useState<number>(editingLayer.position.x);
  const [posY, setPosY] = useState<number>(editingLayer.position.y);
  const [boxW, setBoxW] = useState<number>(editingLayer.size.width);
  const [boxH, setBoxH] = useState<number>(editingLayer.size.height);
  const [startTime, setStartTime] = useState<number>(editingLayer.startTime ?? 0);
  const [layerDuration, setLayerDuration] = useState<number>(editingLayer.layerDuration ?? compositionDuration);
  const [opacity, setOpacity] = useState<number>(() => {
    const raw = props.opacity;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  });

  const previewRef = useRef<HTMLCanvasElement>(null);

  // Live preview — redraws whenever the palette or display toggles change.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const chart: KnittingChart = { cols, rows, palette, cells };
    renderKnittingChart(ctx, 0, 0, canvas.width, canvas.height, chart, {
      showGrid, showNumbers, showLegend, background, gridColor,
    });
  }, [palette, showGrid, showNumbers, showLegend, cols, rows, cells, background, gridColor]);

  const setColor = (i: number, hex: string) => {
    setPalette((prev) => { const next = prev.slice(); next[i] = hex; return next; });
  };

  const handleSave = () => {
    onAdd({
      ...editingLayer, // preserve cells / cols / rows / everything else (Lesson 21)
      position: { x: posX, y: posY },
      size: { width: Math.max(1, boxW), height: Math.max(1, boxH) },
      startTime,
      layerDuration,
      properties: {
        ...editingLayer.properties,
        palette,
        showGrid,
        showNumbers,
        showLegend,
        opacity,
      },
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Editing a <span className="text-sky-400">pixel grid</span> ({cols}×{rows}, {palette.length} colors).
        Change a color below and every pixel using it recolors.
      </p>

      {/* Live preview */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-2">
        <canvas ref={previewRef} width={480} height={360} className="w-full rounded bg-slate-900" />
      </div>

      {/* Palette swatches */}
      <div>
        <label className="text-xs text-slate-400 mb-2 block">Colors</label>
        <div className="grid grid-cols-6 gap-2">
          {palette.map((hex, i) => (
            <label key={i} className="flex flex-col items-center gap-1 cursor-pointer" title={`Color ${i + 1}: ${hex}`}>
              <span className="relative block w-full">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
                  onChange={(e) => setColor(i, e.target.value)}
                  className="w-full h-9 rounded border border-slate-600 bg-transparent cursor-pointer"
                />
              </span>
              <span className="text-[10px] text-slate-500">{i + 1}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Display toggles */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Numbers
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} /> Legend
        </label>
      </div>

      {/* Box / timing / opacity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">X</label>
          <input type="number" value={posX} onChange={(e) => setPosX(Math.round(Number(e.target.value) || 0))}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Y</label>
          <input type="number" value={posY} onChange={(e) => setPosY(Math.round(Number(e.target.value) || 0))}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Width</label>
          <input type="number" min={1} value={boxW} onChange={(e) => setBoxW(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Height</label>
          <input type="number" min={1} value={boxH} onChange={(e) => setBoxH(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Start (s)</label>
          <input type="number" min={0} step={0.1} value={startTime} onChange={(e) => setStartTime(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Duration (s)</label>
          <input type="number" min={0.1} step={0.1} value={layerDuration} onChange={(e) => setLayerDuration(Math.max(0.1, Number(e.target.value) || 0.1))}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Opacity ({opacity.toFixed(2)})</label>
        <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
      </div>

      <button onClick={handleSave}
        className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
        Save Changes
      </button>
    </div>
  );
};
