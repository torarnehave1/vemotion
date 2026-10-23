import React, { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Eraser, Plus } from 'lucide-react';
import type { Layer } from '../lib/api';
import { buildKnittingChart, renderKnittingChart, knittingCellAt, knittingChartGeometry, type KnittingChart } from '../lib/knitting';
import { uploadImageToAlbum, importImageUrlToAlbum, trackUnsplashDownload, type StockImage } from '../lib/photoAlbum';
import { StockImagePicker } from './StockImagePicker';
import { AiImagePrompt } from './AiImagePrompt';

/**
 * Logical size of the editor preview. The layout (gutters, legend, hit-testing)
 * is computed in these units; the canvas backing store is the on-screen size ×
 * devicePixelRatio and a transform maps between them, so the grid is drawn at
 * the screen's real resolution instead of being stretched.
 */
const PREVIEW_W = 480;
const PREVIEW_H = 360;

/** Largest grid the "add stitches" buttons grow to (per side). */
const MAX_GRID = 200;

type GrowSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Grow a chart by `n` columns (left/right) or rows (top/bottom) without
 * touching what is drawn. New cells get palette index `blankIdx`. The recorded
 * paint sequence stores flat indices r*cols+c, so every entry is re-addressed
 * to the new width and the shifted origin.
 */
function growChart(
  chart: KnittingChart,
  drawOrder: number[],
  side: GrowSide,
  n: number,
  blankIdx: number,
): { chart: KnittingChart; drawOrder: number[] } {
  const horizontal = side === 'left' || side === 'right';
  const cols = chart.cols + (horizontal ? n : 0);
  const rows = chart.rows + (horizontal ? 0 : n);
  const dc = side === 'left' ? n : 0;
  const dr = side === 'top' ? n : 0;
  const blank = blankIdx.toString(36);
  const old = Array.from({ length: chart.rows }, (_, r) => (chart.cells[r] ?? '').padEnd(chart.cols, '0').slice(0, chart.cols));
  let cells: string[];
  if (side === 'left') cells = old.map((row) => blank.repeat(n) + row);
  else if (side === 'right') cells = old.map((row) => row + blank.repeat(n));
  else {
    const fresh = Array.from({ length: n }, () => blank.repeat(cols));
    cells = side === 'top' ? [...fresh, ...old] : [...old, ...fresh];
  }
  const order = drawOrder.map((f) => {
    const r = Math.floor(f / chart.cols);
    const c = f % chart.cols;
    return (r + dr) * cols + (c + dc);
  });
  return { chart: { ...chart, cols, rows, cells }, drawOrder: order };
}

/** A selected block of cells, inclusive, normalised so r0<=r1 and c0<=c1. */
interface CellRect { r0: number; c0: number; r1: number; c1: number }

const normRect = (a: { r: number; c: number }, b: { r: number; c: number }): CellRect => ({
  r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c),
});

type RepeatDir = 'horizontal' | 'vertical' | 'both';

/**
 * Repeat the selected block to the edges of the grid (a knitting "rapport"),
 * phase-aligned with the selection: horizontal fills the selection's rows
 * across the full width, vertical fills its columns over the full height, both
 * fills the whole grid. Existing cells are overwritten; partial tiles at the
 * edges are cut.
 *
 * Changed cells that are not background are appended to the paint sequence so
 * the repeat draws itself in the video: tile by tile moving out from the
 * selection, and inside a tile in the same order the source cells were drawn
 * (unrecorded source cells after, row by row). Cells already in the sequence
 * keep their place, as with brush painting.
 */
function repeatSelection(
  chart: KnittingChart,
  drawOrder: number[],
  sel: CellRect,
  dir: RepeatDir,
  blankIdx: number,
): { chart: KnittingChart; drawOrder: number[] } {
  const { cols, rows } = chart;
  const h = sel.r1 - sel.r0 + 1;
  const w = sel.c1 - sel.c0 + 1;
  const src = Array.from({ length: rows }, (_, r) => (chart.cells[r] ?? '').padEnd(cols, '0').slice(0, cols));
  const out = src.map((row) => row.split(''));
  const rank = new Map<number, number>();
  drawOrder.forEach((f, i) => { if (!rank.has(f)) rank.set(f, i); });
  const inOrder = new Set(drawOrder);
  const blank = blankIdx.toString(36);
  const mod = (a: number, m: number) => ((a % m) + m) % m;

  const rFrom = dir === 'horizontal' ? sel.r0 : 0;
  const rTo = dir === 'horizontal' ? sel.r1 : rows - 1;
  const cFrom = dir === 'vertical' ? sel.c0 : 0;
  const cTo = dir === 'vertical' ? sel.c1 : cols - 1;

  const added: { flat: number; key: number[] }[] = [];
  for (let r = rFrom; r <= rTo; r++) {
    for (let c = cFrom; c <= cTo; c++) {
      const tr = Math.floor((r - sel.r0) / h);
      const tc = Math.floor((c - sel.c0) / w);
      if (tr === 0 && tc === 0) continue; // the selection itself
      const sr = sel.r0 + mod(r - sel.r0, h);
      const sc = sel.c0 + mod(c - sel.c0, w);
      const ch = src[sr][sc];
      if (out[r][c] === ch) continue;
      out[r][c] = ch;
      const flat = r * cols + c;
      if (ch !== blank && !inOrder.has(flat)) {
        const srcFlat = sr * cols + sc;
        const within = rank.has(srcFlat) ? rank.get(srcFlat)! : drawOrder.length + srcFlat;
        added.push({ flat, key: [Math.abs(tr) + Math.abs(tc), tr, tc, within] });
      }
    }
  }
  added.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  return {
    chart: { ...chart, cells: out.map((row) => row.join('')) },
    drawOrder: [...drawOrder, ...added.map((a) => a.flat)],
  };
}

/**
 * Mirror the selected block. `axis` 'h' flips left↔right, 'v' flips top↕bottom.
 *
 * - In place: the block is flipped inside the selection. Recorded paint steps
 *   inside it move with their stitches, so the playback draws the mirrored
 *   stroke (the sequence length is unchanged).
 * - Copy: a mirrored copy is written next to the selection on `side`
 *   ('before' = left/above, 'after' = right/below), cut at the grid edge and
 *   overwriting what is there. `sharedCentre` uses the outer row/column of the
 *   selection as the mirror line, so it is not doubled; otherwise the selection
 *   edge is the mirror line and the outer row/column repeats. Changed
 *   non-background cells are appended to the paint sequence in the order the
 *   source stitches were drawn.
 */
function mirrorSelection(
  chart: KnittingChart,
  drawOrder: number[],
  sel: CellRect,
  axis: 'h' | 'v',
  mode: 'inplace' | 'copy',
  side: 'before' | 'after',
  sharedCentre: boolean,
  blankIdx: number,
): { chart: KnittingChart; drawOrder: number[] } {
  const { cols, rows } = chart;
  const src = Array.from({ length: rows }, (_, r) => (chart.cells[r] ?? '').padEnd(cols, '0').slice(0, cols));
  const out = src.map((row) => row.split(''));

  if (mode === 'inplace') {
    const flip = (r: number, c: number) => (axis === 'h' ? [r, sel.c0 + sel.c1 - c] : [sel.r0 + sel.r1 - r, c]);
    for (let r = sel.r0; r <= sel.r1; r++) {
      for (let c = sel.c0; c <= sel.c1; c++) {
        const [fr, fc] = flip(r, c);
        out[fr][fc] = src[r][c];
      }
    }
    const order = drawOrder.map((f) => {
      const r = Math.floor(f / cols);
      const c = f % cols;
      if (r < sel.r0 || r > sel.r1 || c < sel.c0 || c > sel.c1) return f;
      const [fr, fc] = flip(r, c);
      return fr * cols + fc;
    });
    return { chart: { ...chart, cells: out.map((row) => row.join('')) }, drawOrder: order };
  }

  // Copy beside: target of source (r, c), or null when it falls on the axis / off the grid.
  const shift = sharedCentre ? 0 : 1;
  const target = (r: number, c: number): [number, number] | null => {
    let tr = r;
    let tc = c;
    if (axis === 'h') tc = side === 'after' ? sel.c1 + shift + (sel.c1 - c) : sel.c0 - shift - (c - sel.c0);
    else tr = side === 'after' ? sel.r1 + shift + (sel.r1 - r) : sel.r0 - shift - (r - sel.r0);
    if (tr >= sel.r0 && tr <= sel.r1 && tc >= sel.c0 && tc <= sel.c1) return null; // the shared axis itself
    if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) return null;
    return [tr, tc];
  };
  const rank = new Map<number, number>();
  drawOrder.forEach((f, i) => { if (!rank.has(f)) rank.set(f, i); });
  const inOrder = new Set(drawOrder);
  const blank = blankIdx.toString(36);
  const added: { flat: number; key: number }[] = [];
  for (let r = sel.r0; r <= sel.r1; r++) {
    for (let c = sel.c0; c <= sel.c1; c++) {
      const t = target(r, c);
      if (!t) continue;
      const [tr, tc] = t;
      const ch = src[r][c];
      if (out[tr][tc] === ch) continue;
      out[tr][tc] = ch;
      const flat = tr * cols + tc;
      if (ch !== blank && !inOrder.has(flat)) {
        const srcFlat = r * cols + c;
        added.push({ flat, key: rank.has(srcFlat) ? rank.get(srcFlat)! : drawOrder.length + srcFlat });
      }
    }
  }
  added.sort((a, b) => a.key - b.key);
  return {
    chart: { ...chart, cells: out.map((row) => row.join('')) },
    drawOrder: [...drawOrder, ...added.map((a) => a.flat)],
  };
}

interface PixelGridEditFormProps {
  editingLayer: Layer;
  compositionDuration: number;
  /**
   * `opts.minCompositionDuration` grows the composition to at least that many seconds
   * in the same update as the layer — used on save when a pixel-reveal animation needs
   * more time than the composition has. The parent clamps with Math.max (never shrinks).
   */
  onAdd: (layer: Layer, opts?: { minCompositionDuration?: number }) => void;
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

  // Select tool: drag a rectangle of cells, then repeat it (rapport).
  const [tool, setTool] = useState<'paint' | 'select'>('paint');
  const [selection, setSelection] = useState<CellRect | null>(null);
  const selectAnchor = useRef<{ r: number; c: number } | null>(null);

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
  // Per-stitch pacing: each painted cell takes this many seconds (default 1).
  // Total reveal = secondsPerPixel × number of painted stitches. Initialised by
  // dividing an existing pixel-reveal's total duration back out by stitch count.
  const [secondsPerPixel, setSecondsPerPixel] = useState<number>(() => {
    const last = existingReveal?.keyframes?.[existingReveal.keyframes.length - 1]?.time;
    const n = Array.isArray(props.drawOrder) ? (props.drawOrder as number[]).length : 0;
    return typeof last === 'number' && last > 0 && n > 0 ? last / n : 1;
  });

  // Synchronous source of truth for painting. A pointer drag fires many events
  // between React renders; reading/writing state directly would use a stale
  // closure and the record-into-drawOrder step would mostly miss. The refs are
  // updated synchronously inside the handlers and mirrored back to state for
  // the preview + save. (Backstop effects keep them in sync after other paths.)
  const chartRef = useRef(chart);
  const drawOrderRef = useRef<number[]>(drawOrder);
  useEffect(() => { chartRef.current = chart; }, [chart]);
  useEffect(() => { drawOrderRef.current = drawOrder; }, [drawOrder]);

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

  // When animating, the layer's own duration IS the reveal length
  // (stitches × seconds-per-stitch), so the Duration field tracks the pacing
  // live. The composition duration is grown to fit on save (handleSave).
  useEffect(() => {
    if (animateDrawing && drawOrder.length > 0) {
      setLayerDuration(Math.max(0.1, secondsPerPixel * drawOrder.length));
    }
  }, [animateDrawing, secondsPerPixel, drawOrder.length]);

  const previewRef = useRef<HTMLCanvasElement>(null);
  // Backing-store size of the preview canvas (device pixels); follows the
  // canvas's CSS size and the devicePixelRatio.
  const [previewPx, setPreviewPx] = useState({ w: PREVIEW_W, h: PREVIEW_H });
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      setPreviewPx((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    // A DPR change (window moved to another screen) does not resize the box.
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', measure);
    return () => { ro.disconnect(); mq.removeEventListener('change', measure); };
  }, []);
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
    chartRef.current = next;
    drawOrderRef.current = [];
    setChart(next);
    setPalette(next.palette.slice());
    setDrawOrder([]); // re-pixelating replaces the drawing — old order is moot
    setSelection(null);
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

  // Pick a stock photo as a NEW source: import into the album, then re-pixelate
  // from it at the current stitch/colour count (touched → rebuild effect).
  const [pickedStockUrl, setPickedStockUrl] = useState('');
  const handleStockPick = async (image: StockImage) => {
    setSourceUploading(true);
    setPickedStockUrl(image.url);
    try {
      void trackUnsplashDownload(image.download_location);
      const albumUrl = await importImageUrlToAlbum(image.url);
      touched.current = true;
      setSourceUrl(albumUrl);
    } catch { /* leave current grid intact on failure */ }
    finally { setSourceUploading(false); }
  };

  // AI-generated image (already in the album) → re-pixelate the grid from it.
  const handleAiResult = (albumUrl: string) => {
    setPickedStockUrl(albumUrl);
    touched.current = true;
    setSourceUrl(albumUrl);
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
    const nextChart = { ...chart, palette: pal, cells: Array.from({ length: chart.rows }, () => blankRow) };
    chartRef.current = nextChart;
    drawOrderRef.current = [];
    setPalette(pal);
    setChart(nextChart);
    setBrushIndex(0);
    setDrawOrder([]); // blank canvas — nothing drawn yet
    setSelection(null);
  };

  // Add stitches on one side, keeping the drawing. New cells are the background
  // yarn (added to the palette if missing, as clearGrid does). The layer box is
  // unchanged, so the cells shrink to fit.
  const [growBy, setGrowBy] = useState(1);
  const grow = (side: GrowSide) => {
    const current = chartRef.current;
    if (current.cols <= 0 || current.rows <= 0) return;
    const horizontal = side === 'left' || side === 'right';
    const n = Math.max(0, Math.min(Math.round(growBy) || 0, MAX_GRID - (horizontal ? current.cols : current.rows)));
    if (n <= 0) return;
    const pal = (palette.length === current.palette.length ? palette : current.palette).slice();
    let blankIdx = pal.findIndex((h) => h.toLowerCase() === background.toLowerCase());
    if (blankIdx === -1) {
      if (pal.length >= 36) blankIdx = 0; // palette full — fall back to colour 1
      else { pal.push(background); blankIdx = pal.length - 1; }
    }
    const next = growChart({ ...current, palette: pal }, drawOrderRef.current, side, n, blankIdx);
    chartRef.current = next.chart;
    drawOrderRef.current = next.drawOrder;
    setPalette(pal);
    setChart(next.chart);
    setDrawOrder(next.drawOrder);
    setSelection(null); // cell addresses moved
  };

  // Background yarn index for repeat (cells of this colour are not "drawn").
  const backgroundIndex = (pal: string[]) => pal.findIndex((h) => h.toLowerCase() === background.toLowerCase());

  const repeat = (dir: RepeatDir) => {
    if (!selection) return;
    const current = chartRef.current;
    const pal = palette.length === current.palette.length ? palette : current.palette;
    const next = repeatSelection(current, drawOrderRef.current, selection, dir, backgroundIndex(pal));
    chartRef.current = next.chart;
    drawOrderRef.current = next.drawOrder;
    setChart(next.chart);
    setDrawOrder(next.drawOrder);
  };

  // Mirror line for "copy beside": the selection edge (outer row/column
  // doubled) or its outer row/column shared (not doubled).
  const [sharedCentre, setSharedCentre] = useState(false);
  const mirror = (axis: 'h' | 'v', mode: 'inplace' | 'copy', side: 'before' | 'after' = 'after') => {
    if (!selection) return;
    const current = chartRef.current;
    const pal = palette.length === current.palette.length ? palette : current.palette;
    const next = mirrorSelection(current, drawOrderRef.current, selection, axis, mode, side, sharedCentre, backgroundIndex(pal));
    chartRef.current = next.chart;
    drawOrderRef.current = next.drawOrder;
    setChart(next.chart);
    setDrawOrder(next.drawOrder);
  };

  // Append a new yarn colour and select it as the active brush.
  const addColor = () => {
    if (effectivePalette.length >= 36) return; // base36 single-char index ceiling
    const next = [...effectivePalette, '#000000'];
    const nextChart = { ...chartRef.current, palette: next };
    chartRef.current = nextChart;
    setPalette(next);
    setChart(nextChart);
    setBrushIndex(next.length - 1);
  };

  // Paint the cell under a pointer event with the active brush. Reads + writes
  // through the refs so rapid drag events stay consistent and every painted
  // cell is recorded into the draw order (first occurrence wins, so a later
  // recolor of the same cell doesn't move it in the reveal sequence).
  const cellAtPointer = (clientX: number, clientY: number) => {
    const canvas = previewRef.current;
    const current = chartRef.current;
    if (!canvas || current.cols <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (PREVIEW_W / rect.width);
    const py = (clientY - rect.top) * (PREVIEW_H / rect.height);
    return knittingCellAt(PREVIEW_W, PREVIEW_H, current, { showNumbers, showLegend }, px, py);
  };

  // Select tool: press sets the anchor cell, drag extends the rectangle.
  const selectAtPointer = (clientX: number, clientY: number, start: boolean) => {
    const hit = cellAtPointer(clientX, clientY);
    if (!hit) return;
    if (start || !selectAnchor.current) selectAnchor.current = hit;
    setSelection(normRect(selectAnchor.current, hit));
  };

  const paintAtPointer = (clientX: number, clientY: number) => {
    const current = chartRef.current;
    const hit = cellAtPointer(clientX, clientY);
    if (!hit) return;
    const ch = safeBrush.toString(36);
    let row = current.cells[hit.r] ?? '';
    if (row.length < current.cols) row = row.padEnd(current.cols, '0');
    if (row[hit.c] === ch) return; // genuine no-op — same colour already there

    const cells = current.cells.slice();
    cells[hit.r] = row.slice(0, hit.c) + ch + row.slice(hit.c + 1);
    const nextChart = { ...current, cells };
    chartRef.current = nextChart;
    setChart(nextChart);

    const flat = hit.r * current.cols + hit.c;
    if (!drawOrderRef.current.includes(flat)) {
      const nextOrder = [...drawOrderRef.current, flat];
      drawOrderRef.current = nextOrder;
      setDrawOrder(nextOrder);
    }
  };

  const canPaint = chart.cols > 0 && chart.rows > 0;

  // Live preview.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== previewPx.w) canvas.width = previewPx.w;
    if (canvas.height !== previewPx.h) canvas.height = previewPx.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / PREVIEW_W, 0, 0, canvas.height / PREVIEW_H, 0, 0);
    renderKnittingChart(ctx, 0, 0, PREVIEW_W, PREVIEW_H, { ...chart, palette: effectivePalette }, {
      showGrid, showNumbers, showLegend, background, gridColor,
    });
    // Selection outline — editor overlay only, never part of the layer/video.
    if (selection && chart.cols > 0 && chart.rows > 0) {
      const { gx, gy, cell } = knittingChartGeometry(0, 0, PREVIEW_W, PREVIEW_H, chart, { showNumbers, showLegend });
      const x = gx + selection.c0 * cell;
      const y = gy + selection.r0 * cell;
      const w = (selection.c1 - selection.c0 + 1) * cell;
      const h = (selection.r1 - selection.r0 + 1) * cell;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#0284c7';
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, [chart, effectivePalette, showGrid, showNumbers, showLegend, background, gridColor, selection, previewPx]);

  const handleSave = () => {
    // Pixel-reveal animation lives in animations[] (keyframes in layer-local
    // time: 0 → revealDuration). Replace any prior pixel-reveal; preserve other
    // animations. Drop a legacy pixel-reveal from the single `animation` slot.
    const otherAnims = (editingLayer.animations ?? []).filter((a) => a.kind !== 'pixel-reveal');
    const totalReveal = Math.max(0.1, secondsPerPixel * drawOrder.length);
    const animations = (animateDrawing && drawOrder.length > 0)
      ? [...otherAnims, {
          kind: 'pixel-reveal' as const,
          keyframes: [{ time: 0, value: 0 }, { time: totalReveal, value: 1 }],
          easing: 'linear' as const,
        }]
      : otherAnims;
    const animation = editingLayer.animation?.kind === 'pixel-reveal' ? undefined : editingLayer.animation;

    // The layer must stay alive for the whole reveal, and the composition must
    // be long enough to actually play it. Grow both to fit (never shrink).
    const animating = animateDrawing && drawOrder.length > 0;
    const effLayerDuration = animating ? Math.max(layerDuration, totalReveal) : layerDuration;
    // Passed WITH the layer: a separate duration callback would be built from
    // the same render's composition as onAdd, so the later call overwrote the growth.
    const growTo = animating ? { minCompositionDuration: startTime + totalReveal } : undefined;

    onAdd({
      ...editingLayer, // preserve everything else (Lesson 21)
      position: { x: posX, y: posY },
      size: { width: Math.max(1, boxW), height: Math.max(1, boxH) },
      startTime,
      layerDuration: effLayerDuration,
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
    }, growTo);
  };

  const num = 'w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Editing a <span className="text-sky-400">pixel grid</span> ({chart.cols}×{chart.rows}, {effectivePalette.length} colors).
      </p>

      {/* Live preview — click/drag a cell to paint it with the selected colour. */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/50 p-2">
        <canvas
          ref={previewRef}
          width={PREVIEW_W}
          height={PREVIEW_H}
          className="w-full rounded bg-white dark:bg-slate-900"
          style={{ aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}`, cursor: canPaint ? 'crosshair' : 'default', touchAction: 'none' }}
          onMouseDown={(e) => {
            if (!canPaint) return;
            painting.current = true;
            if (tool === 'select') selectAtPointer(e.clientX, e.clientY, true);
            else paintAtPointer(e.clientX, e.clientY);
          }}
          onMouseMove={(e) => {
            if (!painting.current) return;
            if (tool === 'select') selectAtPointer(e.clientX, e.clientY, false);
            else paintAtPointer(e.clientX, e.clientY);
          }}
          onMouseUp={(e) => {
            // A quick drag can end without a move over the end cell — take the release point too.
            if (painting.current && tool === 'select') selectAtPointer(e.clientX, e.clientY, false);
            painting.current = false;
          }}
          onMouseLeave={() => { painting.current = false; }}
        />
      </div>

      {/* Tool: paint with the brush, or select a block of cells to repeat */}
      <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/40 dark:bg-slate-800/40 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 rounded-lg bg-slate-200/60 dark:bg-slate-800 p-1">
            <button type="button" onClick={() => setTool('paint')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${tool === 'paint' ? 'bg-sky-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'}`}>Paint</button>
            <button type="button" onClick={() => setTool('select')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${tool === 'select' ? 'bg-sky-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'}`}>Select</button>
          </div>
          <span className="text-[11px] text-slate-500">
            {selection
              ? `Selected ${selection.c1 - selection.c0 + 1} × ${selection.r1 - selection.r0 + 1} stitches`
              : tool === 'select' ? 'drag over the grid to select a pattern' : 'click/drag to paint with the selected colour'}
          </span>
          {selection && (
            <button type="button" onClick={() => setSelection(null)} className="text-[11px] text-sky-500 hover:underline">clear selection</button>
          )}
        </div>
        {selection && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400">Repeat to the edge</span>
            <button onClick={() => repeat('horizontal')} disabled={!selection}
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">↔ Horizontal</button>
            <button onClick={() => repeat('vertical')} disabled={!selection}
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">↕ Vertical</button>
            <button onClick={() => repeat('both')} disabled={!selection}
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">Both</button>
          </div>
        )}
        {selection && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400">Mirror in place</span>
            <button onClick={() => mirror('h', 'inplace')} title="Flip the selection left ↔ right"
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">↔ Flip</button>
            <button onClick={() => mirror('v', 'inplace')} title="Flip the selection top ↕ bottom"
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">↕ Flip</button>
          </div>
        )}
        {selection && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400">Mirrored copy</span>
              <button onClick={() => mirror('h', 'copy', 'before')} title="Mirrored copy to the left of the selection"
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">← Left</button>
              <button onClick={() => mirror('h', 'copy', 'after')} title="Mirrored copy to the right of the selection"
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">Right →</button>
              <button onClick={() => mirror('v', 'copy', 'before')} title="Mirrored copy above the selection"
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">↑ Above</button>
              <button onClick={() => mirror('v', 'copy', 'after')} title="Mirrored copy below the selection"
              className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">Below ↓</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-500">Mirror line</span>
              <div className="flex gap-1 rounded-lg bg-slate-200/60 dark:bg-slate-800 p-1">
                <button type="button" onClick={() => setSharedCentre(false)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${sharedCentre === false ? 'bg-sky-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'}`}>Edge (outer stitch doubled)</button>
                <button type="button" onClick={() => setSharedCentre(true)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${sharedCentre === true ? 'bg-sky-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'}`}>Shared centre (not doubled)</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Clear / paint toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={clearGrid}
          disabled={!canPaint}
          className="flex items-center gap-2 px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition"
        >
          <Eraser className="w-4 h-4" /> Clear grid
        </button>
        <span className="text-[11px] text-slate-500">blanks every cell — then click a colour below and paint on the grid</span>
      </div>

      {/* Add stitches on a chosen side — keeps the drawing (unlike the source sliders). */}
      <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/40 dark:bg-slate-800/40 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 dark:text-slate-400">Add</span>
          <input type="number" min={1} max={MAX_GRID} value={growBy}
            onChange={(e) => setGrowBy(Math.max(1, Math.min(MAX_GRID, Math.round(Number(e.target.value)) || 1)))}
            className="w-16 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <span className="text-xs text-slate-500 dark:text-slate-400">columns</span>
          <button onClick={() => grow('left')} disabled={!canPaint}
            className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">← Left</button>
          <button onClick={() => grow('right')} disabled={!canPaint}
            className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">Right →</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 dark:text-slate-400">Add {growBy} rows</span>
          <button onClick={() => grow('top')} disabled={!canPaint}
            className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">↑ Top</button>
          <button onClick={() => grow('bottom')} disabled={!canPaint}
            className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">Bottom ↓</button>
        </div>
        <p className="text-[11px] text-slate-500">New stitches are background colour. Your drawing and its playback order are kept; the stitches get smaller to fit the layer.</p>
      </div>

      {/* Stitches / colours — need the source image */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleSetSource} />
      {sourceUrl ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Stitches across</span><span className="text-slate-900 dark:text-slate-200">{cols}</span>
            </label>
            <input type="range" min={10} max={80} value={cols} disabled={!sourceImg}
              onChange={(e) => changeCols(Number(e.target.value))} className="w-full accent-sky-500 disabled:opacity-40" />
          </div>
          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Yarn colours</span><span className="text-slate-900 dark:text-slate-200">{colors}</span>
            </label>
            <input type="range" min={2} max={16} value={colors} disabled={!sourceImg}
              onChange={(e) => changeColors(Number(e.target.value))} className="w-full accent-sky-500 disabled:opacity-40" />
          </div>
          {!sourceImg && <p className="text-[11px] text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading source image…</p>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={() => fileInputRef.current?.click()} disabled={sourceUploading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition">
            <Upload className="w-4 h-4" /> Set source image
          </button>
          {sourceUploading && <Loader2 className="w-4 h-4 animate-spin text-slate-500 dark:text-slate-400" />}
          <span className="text-[11px] text-slate-500">enables changing stitches/colours</span>
        </div>
      )}

      {/* Stock photo search — pick one to re-pixelate the grid from it */}
      <StockImagePicker onPick={handleStockPick} pickedUrl={pickedStockUrl} busy={sourceUploading} />

      {/* AI image generation (gpt-image-2) — re-pixelate from a prompt */}
      <AiImagePrompt onResult={handleAiResult} busy={sourceUploading} />

      {/* Palette — click a swatch to pick the paint brush; edit / add colours below */}
      {effectivePalette.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-slate-500 dark:text-slate-400 block">Colors (click to select the brush)</label>
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
              className="w-7 h-7 rounded border-2 border-dashed border-slate-600 hover:border-sky-400 disabled:opacity-40 text-slate-500 dark:text-slate-400 flex items-center justify-center transition"
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
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid</label>
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"><input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Numbers</label>
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"><input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} /> Legend</label>
      </div>

      {/* Animate the recorded drawing, stitch by stitch */}
      <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/40 dark:bg-slate-800/40 p-3">
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={animateDrawing}
            onChange={(e) => setAnimateDrawing(e.target.checked)} />
          Animate drawing (pixel by pixel)
        </label>
        {drawOrder.length === 0 ? (
          <p className="text-[11px] text-slate-500">Every cell you paint is recorded automatically. Paint on the grid above, then this plays the strokes back in order.</p>
        ) : (
          <>
            <p className="text-[11px] text-slate-500">{drawOrder.length} painted stitches will appear in the order you painted them.</p>
            {animateDrawing && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-slate-500 dark:text-slate-400">Seconds per stitch</label>
                <input type="number" min={0.1} step={0.1} value={secondsPerPixel}
                  onChange={(e) => setSecondsPerPixel(Math.max(0.1, Number(e.target.value) || 0.1))}
                  className="w-24 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
                <span className="text-[11px] text-slate-500">
                  ≈ {(secondsPerPixel * drawOrder.length).toFixed(1)}s total for {drawOrder.length} stitches
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Box / timing / opacity */}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">X</label><input type="number" value={posX} onChange={(e) => setPosX(Math.round(Number(e.target.value) || 0))} className={num} /></div>
        <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Y</label><input type="number" value={posY} onChange={(e) => setPosY(Math.round(Number(e.target.value) || 0))} className={num} /></div>
        <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Width</label><input type="number" min={1} value={boxW} onChange={(e) => setBoxW(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={num} /></div>
        <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Height</label><input type="number" min={1} value={boxH} onChange={(e) => setBoxH(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={num} /></div>
        <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Start (s)</label><input type="number" min={0} step={0.1} value={startTime} onChange={(e) => setStartTime(Math.max(0, Number(e.target.value) || 0))} className={num} /></div>
        <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Duration (s)</label><input type="number" min={0.1} step={0.1} value={layerDuration} onChange={(e) => setLayerDuration(Math.max(0.1, Number(e.target.value) || 0.1))} className={num} /></div>
      </div>
      <div>
        <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Opacity ({opacity.toFixed(2)})</label>
        <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
      </div>

      <button onClick={handleSave} className="w-full bg-sky-600 hover:bg-sky-500 text-slate-900 dark:text-white font-semibold rounded-lg py-3 transition">
        Save Changes
      </button>
    </div>
  );
};
