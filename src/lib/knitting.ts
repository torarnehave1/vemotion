/**
 * Knitting-chart pixelation. Pure logic, no React, no DOM beyond an offscreen
 * canvas. Turns a source image into a low-resolution grid of stitch-cells, each
 * snapped to one of a small set of "yarn" colours (a knitting recipe).
 *
 * The result is baked into a `knitting-chart` layer's `properties` at creation
 * time. The renderer then only paints cells from `cells` + `palette` — it never
 * touches the source image again, so the layer renders offline in the ffmpeg
 * export and survives save/reload without re-fetching (no CORS at render time).
 *
 * `cells` is encoded as one base36 string per row, each character a palette
 * index, to keep composition JSON compact (palette length is capped at 36).
 */

export interface KnittingChart {
  cols: number;
  rows: number;
  /** Yarn colours, hex `#rrggbb`. length === paletteSize (after de-dup, ≤ requested). */
  palette: string[];
  /** rows × cols. One base36 string per row; each char is an index into `palette`. */
  cells: string[];
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

const MAX_PALETTE = 36; // base36 single-char index ceiling

const toHex = (c: RGB): string => {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
};

/** Median-cut colour quantisation over a flat list of cell colours. */
function medianCut(pixels: RGB[], targetColors: number): RGB[] {
  if (pixels.length === 0) return [{ r: 0, g: 0, b: 0 }];

  let buckets: RGB[][] = [pixels];

  while (buckets.length < targetColors) {
    // Pick the bucket with the largest colour range on any channel to split.
    let widestBucket = -1;
    let widestRange = -1;
    let splitChannel: keyof RGB = 'r';

    buckets.forEach((bucket, i) => {
      if (bucket.length < 2) return;
      (['r', 'g', 'b'] as (keyof RGB)[]).forEach((ch) => {
        let min = 255;
        let max = 0;
        for (const px of bucket) {
          if (px[ch] < min) min = px[ch];
          if (px[ch] > max) max = px[ch];
        }
        const range = max - min;
        if (range > widestRange) {
          widestRange = range;
          widestBucket = i;
          splitChannel = ch;
        }
      });
    });

    if (widestBucket === -1) break; // nothing splittable

    const bucket = buckets[widestBucket];
    bucket.sort((a, b) => a[splitChannel] - b[splitChannel]);
    const mid = Math.floor(bucket.length / 2);
    const lower = bucket.slice(0, mid);
    const upper = bucket.slice(mid);
    buckets.splice(widestBucket, 1, lower, upper);
  }

  // Average each bucket into one representative colour.
  return buckets.map((bucket) => {
    const sum = bucket.reduce(
      (acc, px) => ({ r: acc.r + px.r, g: acc.g + px.g, b: acc.b + px.b }),
      { r: 0, g: 0, b: 0 },
    );
    const n = Math.max(1, bucket.length);
    return { r: sum.r / n, g: sum.g / n, b: sum.b / n };
  });
}

const dist2 = (a: RGB, b: RGB): number => {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
};

const nearestIndex = (c: RGB, palette: RGB[]): number => {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = dist2(c, palette[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

/**
 * Pixelate `img` into a `cols × rows` knitting chart quantised to ~`paletteSize`
 * yarn colours. `rows` is derived from the image aspect so stitches stay square.
 */
export function buildKnittingChart(
  img: HTMLImageElement,
  cols: number,
  paletteSize: number,
): KnittingChart {
  const safeCols = Math.max(2, Math.round(cols));
  const aspect = img.naturalHeight > 0 && img.naturalWidth > 0
    ? img.naturalHeight / img.naturalWidth
    : 1;
  const rows = Math.max(2, Math.round(safeCols * aspect));
  const wantColors = Math.max(2, Math.min(MAX_PALETTE, Math.round(paletteSize)));

  // Downscale the image to one pixel per cell. The 2D context's image
  // smoothing averages each source region into that single pixel.
  const small = document.createElement('canvas');
  small.width = safeCols;
  small.height = rows;
  const ctx = small.getContext('2d');
  if (!ctx) throw new Error('No 2D context for knitting pixelation');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, safeCols, rows);

  const { data } = ctx.getImageData(0, 0, safeCols, rows);
  const cellColors: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    cellColors.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }

  const paletteRGB = medianCut(cellColors.map((c) => ({ ...c })), wantColors);
  const palette = paletteRGB.map(toHex);

  // Map each cell to its nearest palette index, encode rows as base36 strings.
  const cells: string[] = [];
  for (let row = 0; row < rows; row++) {
    let rowStr = '';
    for (let col = 0; col < safeCols; col++) {
      const idx = nearestIndex(cellColors[row * safeCols + col], paletteRGB);
      rowStr += idx.toString(36);
    }
    cells.push(rowStr);
  }

  return { cols: safeCols, rows, palette, cells };
}

/** Decode a single base36 cell character back to a palette index. */
export const cellIndex = (ch: string): number => parseInt(ch, 36) || 0;

export interface KnittingChartStyle {
  showGrid: boolean;
  showNumbers: boolean;
  showLegend: boolean;
  /** Chart paper colour. */
  background: string;
  /** Grid line + swatch border colour. */
  gridColor: string;
}

/**
 * Draw a knitting chart into `ctx` within the box (x, y, width, height).
 * Shared by the renderer (composition + MP4 export) and the form's live
 * preview, so what the user previews is exactly what bakes into the video.
 *
 * Layout reserves a right gutter for row numbers, a bottom gutter for column
 * numbers, and a bottom strip for the colour legend. Row numbers follow the
 * knitting convention: row 1 at the bottom, counting up; columns numbered
 * right-to-left (stitch 1 on the right).
 */
export function renderKnittingChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  chart: KnittingChart,
  style: KnittingChartStyle,
): void {
  const { cols, rows, palette, cells } = chart;
  if (cols <= 0 || rows <= 0 || palette.length === 0) return;

  // Paper background.
  ctx.fillStyle = style.background || '#ffffff';
  ctx.fillRect(x, y, width, height);

  // Reserve space (single-pass estimate from an unconstrained cell size).
  const cell0 = Math.min(width / cols, height / rows);
  const rightGutter = style.showNumbers ? Math.max(14, cell0 * 1.8) : 0;
  const bottomGutter = style.showNumbers ? Math.max(12, cell0 * 1.4) : 0;
  const legendH = style.showLegend ? Math.max(16, cell0 * 1.6) : 0;

  const gridW = width - rightGutter;
  const gridH = height - bottomGutter - legendH;
  const cell = Math.max(1, Math.min(gridW / cols, gridH / rows));
  const gw = cell * cols;
  const gh = cell * rows;
  const gx = x;
  const gy = y;

  // Stitch cells.
  for (let r = 0; r < rows; r++) {
    const rowStr = cells[r] ?? '';
    for (let c = 0; c < cols; c++) {
      const idx = cellIndex(rowStr[c] ?? '0');
      ctx.fillStyle = palette[idx] ?? '#000000';
      // +0.5 overdraw hides hairline seams between adjacent cells.
      ctx.fillRect(gx + c * cell, gy + r * cell, cell + 0.5, cell + 0.5);
    }
  }

  // Grid lines (skip when cells are too small to be legible).
  if (style.showGrid && cell >= 3) {
    ctx.strokeStyle = style.gridColor || '#999999';
    ctx.lineWidth = Math.max(0.5, cell * 0.04);
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const px = gx + c * cell;
      ctx.moveTo(px, gy);
      ctx.lineTo(px, gy + gh);
    }
    for (let r = 0; r <= rows; r++) {
      const py = gy + r * cell;
      ctx.moveTo(gx, py);
      ctx.lineTo(gx + gw, py);
    }
    ctx.stroke();

    // Heavier lines every 10 stitches/rows — the standard chart guide.
    ctx.lineWidth = Math.max(1, cell * 0.1);
    ctx.beginPath();
    for (let c = 0; c <= cols; c += 10) {
      const px = gx + c * cell;
      ctx.moveTo(px, gy);
      ctx.lineTo(px, gy + gh);
    }
    for (let r = 0; r <= rows; r += 10) {
      const py = gy + r * cell;
      ctx.moveTo(gx, py);
      ctx.lineTo(gx + gw, py);
    }
    ctx.stroke();
  }

  // Row / column numbers.
  if (style.showNumbers) {
    const fs = Math.max(7, Math.min(rightGutter * 0.6, cell * 0.7));
    ctx.fillStyle = '#333333';
    ctx.font = `${fs}px Inter, system-ui, sans-serif`;

    // Row numbers — bottom = row 1, counting up, in the right gutter.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      const label = rows - r;
      if (cell >= 10 || label % 5 === 0 || label === 1 || label === rows) {
        ctx.fillText(String(label), gx + gw + Math.max(3, cell * 0.2), gy + r * cell + cell / 2);
      }
    }

    // Column numbers — right = stitch 1, along the bottom.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let c = 0; c < cols; c++) {
      const label = cols - c;
      if (cell >= 10 || label % 5 === 0 || label === 1 || label === cols) {
        ctx.fillText(String(label), gx + c * cell + cell / 2, gy + gh + Math.max(2, cell * 0.15));
      }
    }
  }

  // Colour legend (swatch + number per yarn).
  if (style.showLegend && legendH > 0) {
    const sw = Math.max(10, legendH * 0.5);
    const ly = y + height - legendH + (legendH - sw) / 2;
    const fs = Math.max(8, sw * 0.7);
    ctx.font = `${fs}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lx = x;
    for (let i = 0; i < palette.length; i++) {
      ctx.fillStyle = palette[i];
      ctx.fillRect(lx, ly, sw, sw);
      ctx.strokeStyle = style.gridColor || '#999999';
      ctx.lineWidth = 1;
      ctx.strokeRect(lx, ly, sw, sw);
      const label = String(i + 1);
      ctx.fillStyle = '#333333';
      ctx.fillText(label, lx + sw + 3, ly + sw / 2);
      lx += sw + 6 + fs * label.length * 0.7 + sw * 0.4;
      if (lx > x + width - sw) break; // overflow clip (MVP)
    }
  }
}
