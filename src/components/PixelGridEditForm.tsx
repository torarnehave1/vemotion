import React, { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Eraser, Plus } from 'lucide-react';
import type { Layer } from '../lib/api';
import { buildKnittingChart, renderKnittingChart, knittingCellAt, type KnittingChart } from '../lib/knitting';
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

  // Manual paint: the active palette index ("brush") clicked cells are filled with.
  const [brushIndex, setBrushIndex] = useState(0);
  const painting = useRef(false);

  // Recorded paint sequence (flat cell indices r*cols+c), first-occurrence
  // order. Drives the pixel-reveal animation. Cleared when the grid is cleared
  // or re-pixelated from a source image (the old drawing no longer applies).
  const [drawOrder, setDrawOrder] = useState<number[]>(
    Array.isArray(props.drawOrder) ? (props.drawOrder as number[]) : [],
  );

  // Animate the recorded drawing stitch-by-stitch (a 'pixel-reveal' animation).
  const existingReveal = (editingLayer.animations ?? []).find((a) => a.kind === 'pixel-reveal')
    ?? (editingLayer.animation?.kind === 'pixel-reveal' ? editingLayer.animation : undefined);
  const [animateDrawing, setAnimateDrawing] = useState<boolean>(!!existingReveal);
  const [revealDuration, setRevealDuration] = useState<number>(() => {
    const last = existingReveal?.keyframes?.[existingReveal.keyframes.length - 1]?.time;
    return typeof last === 'number' && last > 0 ? last : (editingLayer.layerDuration ?? compositionDuration);
  });

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
    setDrawOrder([]); // re-pixelating replaces the drawing — old order is moot
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
  const safeBrush = Math.min(brushIndex, Math.max(0, effectivePalette.length - 1));

  // Blank every cell to the background colour so the user can paint from scratch.
  // The grid dimensions and palette are kept; the background is added to the
  // palette as a "blank" yarn if it isn't already one of the colours.
  const clearGrid = () => {
    if (chart.cols <= 0 || chart.rows <= 0) return;
    const pal = effectivePalette.slice();
    let blankIdx = pal.findIndex((h) => h.toLowerCase() === background.toLowerCase());
    if (blankIdx === -1) { pal.push(background); blankIdx = pal.length - 1; }
    const blankRow = blankIdx.toString(36).repeat(chart.cols);
    setPalette(pal);
    setChart((c) => ({ ...c, palette: pal, cells: Array.from({ length: c.rows }, () => blankRow) }));
    setBrushIndex(0);
    setDrawOrder([]); // blank canvas — nothing drawn yet
  };

  // Append a new yarn colour and select it as the active brush.
  const addColor = () => {
    if (effectivePalette.length >= 36) return; // base36 single-char index ceiling
    const next = [...effectivePalette, '#000000'];
    setPalette(next);
    setChart((c) => ({ ...c, palette: next }));
    setBrushIndex(next.length - 1);
  };

  // Paint the cell under a pointer event with the active brush.
  const paintAtPointer = (clientX: number, clientY: number) => {
    const canvas = previewRef.current;
    if (!canvas || chart.cols <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    const hit = knittingCellAt(canvas.width, canvas.height, chart,
      { showNumbers, showLegend }, px, py);
    if (!hit) return;
    const ch = safeBrush.toString(36);
    let painted = false;
    setChart((c) => {
      const cells = c.cells.slice();
      let row = cells[hit.r] ?? '';
      if (row.length < c.cols) row = row.padEnd(c.cols, '0');
      if (row[hit.c] === ch) return c; // no-op: avoids a re-render per mousemove
      cells[hit.r] = row.slice(0, hit.c) + ch + row.slice(hit.c + 1);
      painted = true;
      return { ...c, cells };
    });
    // Record the stroke into the draw order (first occurrence wins, so a later
    // recolor of the same cell doesn't move it in the reveal sequence).
    if (painted) {
      const flat = hit.r * chart.cols + hit.c;
      setDrawOrder((prev) => (prev.includes(flat) ? prev : [...prev, flat]));
    }
  };

  const canPaint = chart.cols > 0 && chart.rows > 0;

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
    // Pixel-reveal animation lives in animations[] (keyframes in layer-local
    // time: 0 → revealDuration). Replace any prior pixel-reveal; preserve other
    // animations. Drop a legacy pixel-reveal from the single `animation` slot.
    const otherAnims = (editingLayer.animations ?? []).filter((a) => a.kind !== 'pixel-reveal');
    const animations = (animateDrawing && drawOrder.length > 0)
      ? [...otherAnims, {
          kind: 'pixel-reveal' as const,
          keyframes: [{ time: 0, value: 0 }, { time: Math.max(0.1, revealDuration), value: 1 }],
          easing: 'linear' as const,
        }]
      : otherAnims;
    const animation = editingLayer.animation?.kind === 'pixel-reveal' ? undefined : editingLayer.animation;

    onAdd({
      ...editingLayer, // preserve everything else (Lesson 21)
      position: { x: posX, y: posY },
      size: { width: Math.max(1, boxW), height: Math.max(1, boxH) },
      startTime,
      layerDuration,
      animation,
      animations,
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
        drawOrder,
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

      {/* Live preview — click/drag a cell to paint it with the selected colour. */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-2">
        <canvas
          ref={previewRef}
          width={480}
          height={360}
          className="w-full rounded bg-slate-900"
          style={{ cursor: canPaint ? 'crosshair' : 'default', touchAction: 'none' }}
          onMouseDown={(e) => { if (!canPaint) return; painting.current = true; paintAtPointer(e.clientX, e.clientY); }}
          onMouseMove={(e) => { if (painting.current) paintAtPointer(e.clientX, e.clientY); }}
          onMouseUp={() => { painting.current = false; }}
          onMouseLeave={() => { painting.current = false; }}
        />
      </div>

      {/* Clear / paint toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={clearGrid}
          disabled={!canPaint}
          className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
        >
          <Eraser className="w-4 h-4" /> Clear grid
        </button>
        <span className="text-[11px] text-slate-500">blanks every cell — then click a colour below and paint on the grid</span>
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

      {/* Palette — click a swatch to pick the paint brush; edit / add colours below */}
      {effectivePalette.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-slate-400 block">Colors (click to select the brush)</label>
          <div className="flex flex-wrap gap-1.5">
            {effectivePalette.map((hex, i) => (
              <button
                key={i}
                type="button"
                title={`Color ${i + 1}: ${hex}${i === safeBrush ? ' (brush)' : ''}`}
                onClick={() => setBrushIndex(i)}
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000' }}
                className={`w-7 h-7 rounded border-2 cursor-pointer transition ${
                  i === safeBrush ? 'border-sky-400 ring-2 ring-sky-400/40' : 'border-slate-600 hover:border-slate-400'
                }`}
              />
            ))}
            <button
              type="button"
              onClick={addColor}
              disabled={effectivePalette.length >= 36}
              title="Add a new yarn colour"
              className="w-7 h-7 rounded border-2 border-dashed border-slate-600 hover:border-sky-400 disabled:opacity-40 text-slate-400 flex items-center justify-center transition"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-500">Brush color</span>
            <input
              type="color"
              title={`Edit color ${safeBrush + 1}`}
              value={/^#[0-9a-fA-F]{6}$/.test(effectivePalette[safeBrush] || '') ? effectivePalette[safeBrush] : '#000000'}
              onChange={(e) => {
                const next = effectivePalette.slice();
                next[safeBrush] = e.target.value;
                setPalette(next);
                setChart((c) => ({ ...c, palette: next }));
              }}
              className="w-7 h-7 rounded border border-slate-600 bg-transparent cursor-pointer p-0"
            />
            <span className="text-[11px] text-slate-500">recolors every cell using color {safeBrush + 1}</span>
          </div>
        </div>
      )}

      {/* Display toggles */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid</label>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Numbers</label>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} /> Legend</label>
      </div>

      {/* Animate the recorded drawing, stitch by stitch */}
      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={animateDrawing} disabled={drawOrder.length === 0}
            onChange={(e) => setAnimateDrawing(e.target.checked)} />
          Animate drawing (pixel by pixel)
        </label>
        {drawOrder.length === 0 ? (
          <p className="text-[11px] text-slate-500">Paint cells on the grid above to record a drawing to animate.</p>
        ) : (
          <>
            <p className="text-[11px] text-slate-500">{drawOrder.length} painted stitches will appear in the order you painted them.</p>
            {animateDrawing && (
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-400">Reveal over (s)</label>
                <input type="number" min={0.1} step={0.1} value={revealDuration}
                  onChange={(e) => setRevealDuration(Math.max(0.1, Number(e.target.value) || 0.1))}
                  className="w-24 bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
            )}
          </>
        )}
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
