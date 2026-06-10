import React, { useEffect, useRef, useState } from 'react';
import { Upload, Grid3x3, Loader2 } from 'lucide-react';
import type { Layer } from '../lib/api';
import { buildKnittingChart, renderKnittingChart, type KnittingChart } from '../lib/knitting';
import { uploadImageToAlbum } from '../lib/photoAlbum';

interface KnittingChartFormProps {
  onAdd: (layer: Layer) => void;
  compositionWidth: number;
  compositionHeight: number;
}

const generateId = () => `layer-${Date.now().toString(36)}`;

const BACKGROUND = '#ffffff';
const GRID_COLOR = '#999999';

/**
 * Knitting-chart tab content for AddLayerModal.
 *
 * Upload an image, pixelate it into a grid of stitch-cells snapped to a small
 * yarn palette, preview live, then add it as a `knitting-chart` layer. The
 * pixelation is baked into the layer (palette + cell grid) at add time — the
 * source image is not stored, so the chart renders in preview, bakes into the
 * MP4 export, and survives save/reload. Export a PNG screenshot from the
 * sidebar's "Export PNG" button.
 */
export const KnittingChartForm: React.FC<KnittingChartFormProps> = ({
  onAdd,
  compositionWidth,
  compositionHeight,
}) => {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState('');
  const [cols, setCols] = useState(40);
  const [paletteSize, setPaletteSize] = useState(8);
  const [showGrid, setShowGrid] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [chart, setChart] = useState<KnittingChart | null>(null);
  // Editable palette: starts as the auto-quantized colors, the user can
  // override any swatch. Re-synced whenever the chart rebuilds (new image /
  // grid / colour-count), since indices change.
  const [palette, setPalette] = useState<string[]>([]);
  // Source image is persisted to the VEmotion album so the layer can be
  // re-pixelated later (in the edit form) at a different stitch/colour count.
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceUploading, setSourceUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setName(file.name.replace(/\.[^.]+$/, ''));
    // Local preview source.
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => setImg(image);
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    // Persist the source to the VEmotion album so the grid stays re-editable
    // (re-pixelate at a new stitch/colour count from the edit form). Non-fatal:
    // if it fails, the grid still works — it just won't be re-pixelatable.
    setSourceUrl('');
    setSourceUploading(true);
    uploadImageToAlbum(file)
      .then(setSourceUrl)
      .catch(() => { /* leave sourceUrl empty; grid still usable */ })
      .finally(() => setSourceUploading(false));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Recompute the chart whenever the image or grid/palette parameters change.
  useEffect(() => {
    if (!img) {
      setChart(null);
      return;
    }
    setChart(buildKnittingChart(img, cols, paletteSize));
  }, [img, cols, paletteSize]);

  // Reset the editable palette to the auto colours whenever the chart rebuilds.
  useEffect(() => {
    setPalette(chart ? chart.palette.slice() : []);
  }, [chart]);

  // The palette actually used for preview + the saved layer: the user's edits
  // when they line up with the current chart, else the auto palette.
  const effectivePalette = (chart && palette.length === chart.palette.length) ? palette : (chart?.palette ?? []);

  // Redraw the live preview when the chart or display toggles change.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!chart) {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    renderKnittingChart(ctx, 0, 0, canvas.width, canvas.height, { ...chart, palette: effectivePalette }, {
      showGrid,
      showNumbers,
      showLegend,
      background: BACKGROUND,
      gridColor: GRID_COLOR,
    });
  }, [chart, effectivePalette, showGrid, showNumbers, showLegend]);

  const handleAdd = () => {
    if (!chart) return;

    // Size the layer to the grid aspect, fit within ~80% of the canvas.
    const aspect = chart.cols / chart.rows;
    let w = compositionWidth * 0.8;
    let h = w / aspect;
    if (h > compositionHeight * 0.8) {
      h = compositionHeight * 0.8;
      w = h * aspect;
    }
    w = Math.round(w);
    h = Math.round(h);
    const x = Math.round((compositionWidth - w) / 2);
    const y = Math.round((compositionHeight - h) / 2);

    const layer: Layer = {
      id: generateId(),
      type: 'knitting-chart',
      position: { x, y },
      size: { width: w, height: h },
      properties: {
        cols: chart.cols,
        rows: chart.rows,
        palette: effectivePalette,
        cells: chart.cells,
        showGrid,
        showNumbers,
        showLegend,
        background: BACKGROUND,
        gridColor: GRID_COLOR,
        name: name || 'pixel grid',
        ...(sourceUrl ? { sourceImage: sourceUrl } : {}),
      },
    };
    onAdd(layer);
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <div className="flex items-center gap-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition"
        >
          <Upload className="w-4 h-4" /> Choose image
        </button>
        {name && <span className="text-sm text-slate-300 truncate">{name}</span>}
        {sourceUploading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>
      <p className="text-xs text-slate-500">
        The image is pixelated into stitches. The source is saved to your VEmotion album so you can
        re-pixelate (change stitches/colours) later from the layer's edit form.
      </p>

      {/* Live preview */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-2">
        <canvas
          ref={previewRef}
          width={480}
          height={360}
          className="w-full rounded bg-slate-900"
        />
        {!img && (
          <p className="text-center text-xs text-slate-500 py-2 flex items-center justify-center gap-2">
            <Grid3x3 className="w-4 h-4" /> Choose an image to preview the chart
          </p>
        )}
      </div>

      {/* Grid controls */}
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="flex items-center justify-between text-xs text-slate-400">
            <span>Stitches across</span>
            <span className="text-slate-200">{cols}</span>
          </label>
          <input
            type="range"
            min={10}
            max={80}
            value={cols}
            onChange={(e) => setCols(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
          {chart && <p className="text-[11px] text-slate-500">{chart.cols} × {chart.rows} stitches</p>}
        </div>

        <div className="space-y-1">
          <label className="flex items-center justify-between text-xs text-slate-400">
            <span>Yarn colours</span>
            <span className="text-slate-200">{paletteSize}</span>
          </label>
          <input
            type="range"
            min={2}
            max={16}
            value={paletteSize}
            onChange={(e) => setPaletteSize(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          {([
            ['Grid lines', showGrid, setShowGrid],
            ['Numbers', showNumbers, setShowNumbers],
            ['Legend', showLegend, setShowLegend],
          ] as [string, boolean, (v: boolean) => void][]).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => set(e.target.checked)}
                className="accent-sky-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Editable palette — click a small swatch to recolor every pixel using it */}
      {chart && effectivePalette.length > 0 && (
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

      <button
        onClick={handleAdd}
        disabled={!chart}
        className="w-full px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition"
      >
        Add pixel grid
      </button>
    </div>
  );
};
