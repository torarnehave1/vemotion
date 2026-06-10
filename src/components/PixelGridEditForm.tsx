import React, { useEffect, useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import type { Layer } from '../lib/api';
import { buildKnittingChart, renderKnittingChart, type KnittingChart } from '../lib/knitting';
import { uploadImageToAlbum } from '../lib/photoAlbum';

interface PixelGridEditFormProps {
  editingLayer: Layer;
  compositionDuration: number;
  onAdd: (layer: Layer) => void;
}

/**
 * Edit form for an existing `knitting-chart` (pixel-grid) layer.
 *
 * Palette: each pixel is an index into `palette`, so editing a swatch recolors
 * every pixel using it — no per-cell rewrite.
 *
 * Stitches / colours: re-pixelating at a new grid or colour count needs the
 * SOURCE image (the cells alone can't be re-derived at higher detail). The
 * source is stored in the VEmotion album as `properties.sourceImage`; when
 * present, the sliders re-run `buildKnittingChart` from it. Layers created
 * before this (no source) can attach one via "Set source image".
 *
 * Save spreads `...editingLayer` so unknown properties survive (Lesson 21).
 */
export const PixelGridEditForm: React.FC<PixelGridEditFormProps> = ({
  editingLayer,
  compositionDuration,
  onAdd,
}) => {
  const props = editingLayer.properties;
  const background = (props.background as string) || '#ffffff';
  const gridColor = (props.gridColor as string) || '#999999';
  const initialPalette = Array.isArray(props.palette) ? (props.palette as string[]) : [];

  // The chart actually rendered/saved. Starts from the stored properties; the
  // sliders replace it (rebuilt from the source image).
  const [chart, setChart] = useState<KnittingChart>({
    cols: Number(props.cols) || 0,
    rows: Number(props.rows) || 0,
    palette: initialPalette,
    cells: Array.isArray(props.cells) ? (props.cells as string[]) : [],
  });
  const [palette, setPalette] = useState<string[]>(initialPalette.slice());
  const [cols, setCols] = useState<number>(Number(props.cols) || 40);
  const [colors, setColors] = useState<number>(initialPalette.length || 8);

  const [sourceUrl, setSourceUrl] = useState<string>((props.sourceImage as string) || '');
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [sourceUploading, setSourceUploading] = useState(false);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const touched = useRef(false); // true once a slider moved / source attached

  // Load the source image (from the album) so the sliders can re-pixelate.
  useEffect(() => {
    if (!sourceUrl) { setSourceImg(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => setSourceImg(im);
    im.onerror = () => setSourceImg(null);
    im.src = sourceUrl;
  }, [sourceUrl]);

  // Rebuild the chart from the source whenever the user changes a slider, or
  // when the source finishes loading AFTER the user already touched a slider.
  // The initial render keeps the stored chart (preserves prior palette edits).
  const rebuildFrom = (image: HTMLImageElement, c: number, k: number) => {
    const next = buildKnittingChart(image, c, k);
    setChart(next);
    setPalette(next.palette.slice());
  };
  useEffect(() => {
    if (sourceImg && touched.current) rebuildFrom(sourceImg, cols, colors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceImg]);

  const changeCols = (v: number) => { touched.current = true; setCols(v); if (sourceImg) rebuildFrom(sourceImg, v, colors); };
  const changeColors = (v: number) => { touched.current = true; setColors(v); if (sourceImg) rebuildFrom(sourceImg, cols, v); };

  const handleSetSource = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSourceUploading(true);
    try {
      const url = await uploadImageToAlbum(file);
      touched.current = true;
      setSourceUrl(url);
    } catch { /* ignore; layer still editable for colours */ }
    finally { setSourceUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const effectivePalette = palette.length === chart.palette.length ? palette : chart.palette;

  // Live preview.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderKnittingChart(ctx, 0, 0, canvas.width, canvas.height, { ...chart, palette: effectivePalette }, {
      showGrid, showNumbers, showLegend, background, gridColor,
    });
  }, [chart, effectivePalette, showGrid, showNumbers, showLegend, background, gridColor]);

  const handleSave = () => {
    onAdd({
      ...editingLayer, // preserve everything else (Lesson 21)
      position: { x: posX, y: posY },
      size: { width: Math.max(1, boxW), height: Math.max(1, boxH) },
      startTime,
      layerDuration,
      properties: {
        ...editingLayer.properties,
        cols: chart.cols,
        rows: chart.rows,
        cells: chart.cells,
        palette: effectivePalette,
        showGrid,
        showNumbers,
        showLegend,
        opacity,
        ...(sourceUrl ? { sourceImage: sourceUrl } : {}),
      },
    });
  };

  const num = 'w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Editing a <span className="text-sky-400">pixel grid</span> ({chart.cols}×{chart.rows}, {effectivePalette.length} colors).
      </p>

      {/* Live preview */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-2">
        <canvas ref={previewRef} width={480} height={360} className="w-full rounded bg-slate-900" />
      </div>

      {/* Stitches / colours — need the source image */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleSetSource} />
      {sourceUrl ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs text-slate-400">
              <span>Stitches across</span><span className="text-slate-200">{cols}</span>
            </label>
            <input type="range" min={10} max={80} value={cols} disabled={!sourceImg}
              onChange={(e) => changeCols(Number(e.target.value))} className="w-full accent-sky-500 disabled:opacity-40" />
          </div>
          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs text-slate-400">
              <span>Yarn colours</span><span className="text-slate-200">{colors}</span>
            </label>
            <input type="range" min={2} max={16} value={colors} disabled={!sourceImg}
              onChange={(e) => changeColors(Number(e.target.value))} className="w-full accent-sky-500 disabled:opacity-40" />
          </div>
          {!sourceImg && <p className="text-[11px] text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading source image…</p>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={() => fileInputRef.current?.click()} disabled={sourceUploading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition">
            <Upload className="w-4 h-4" /> Set source image
          </button>
          {sourceUploading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          <span className="text-[11px] text-slate-500">enables changing stitches/colours</span>
        </div>
      )}

      {/* Editable palette — small swatches */}
      {effectivePalette.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-slate-400 block">Colors (click to change)</label>
          <div className="flex flex-wrap gap-1.5">
            {effectivePalette.map((hex, i) => (
              <input
                key={i}
                type="color"
                title={`Color ${i + 1}: ${hex}`}
                value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
                onChange={(e) => setPalette((prev) => {
                  const base = prev.length === effectivePalette.length ? prev.slice() : effectivePalette.slice();
                  base[i] = e.target.value;
                  return base;
                })}
                className="w-6 h-6 rounded border border-slate-600 bg-transparent cursor-pointer p-0"
              />
            ))}
          </div>
        </div>
      )}

      {/* Display toggles */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid</label>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Numbers</label>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} /> Legend</label>
      </div>

      {/* Box / timing / opacity */}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-slate-400 mb-1 block">X</label><input type="number" value={posX} onChange={(e) => setPosX(Math.round(Number(e.target.value) || 0))} className={num} /></div>
        <div><label className="text-xs text-slate-400 mb-1 block">Y</label><input type="number" value={posY} onChange={(e) => setPosY(Math.round(Number(e.target.value) || 0))} className={num} /></div>
        <div><label className="text-xs text-slate-400 mb-1 block">Width</label><input type="number" min={1} value={boxW} onChange={(e) => setBoxW(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={num} /></div>
        <div><label className="text-xs text-slate-400 mb-1 block">Height</label><input type="number" min={1} value={boxH} onChange={(e) => setBoxH(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={num} /></div>
        <div><label className="text-xs text-slate-400 mb-1 block">Start (s)</label><input type="number" min={0} step={0.1} value={startTime} onChange={(e) => setStartTime(Math.max(0, Number(e.target.value) || 0))} className={num} /></div>
        <div><label className="text-xs text-slate-400 mb-1 block">Duration (s)</label><input type="number" min={0.1} step={0.1} value={layerDuration} onChange={(e) => setLayerDuration(Math.max(0.1, Number(e.target.value) || 0.1))} className={num} /></div>
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Opacity ({opacity.toFixed(2)})</label>
        <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
      </div>

      <button onClick={handleSave} className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
        Save Changes
      </button>
    </div>
  );
};
