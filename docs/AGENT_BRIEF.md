# Vemotion Composition Briefing (for an AI agent)

System prompt / context document for an agent that creates and edits Vemotion compositions programmatically. Grounded in source files in this repo as of 2026-05-23.

---

## 1. What composition types are available

There is **one** unified `CompositionData` shape — no separate templates. Variation comes from **layer types** inside it. Defined in [src/lib/api.ts:1–48](../src/lib/api.ts).

Layer `type` discriminators (the agent must use one of these):

- `text` — text with `fontSize`, `color`, `align`, `fontWeight`, `fontFamily`. **Image-fill (letters become a window onto an image): see §11.**
- `shape` — primitives (`rect`, `circle`, `ellipse`, `polygon`) with `color`, `opacity`. Optional `strokeColor` + `strokeWidth` for an outline (both required; stroke is drawn on top of fill). Optional `borderRadius` on rect for rounded corners. Any layer (including this one) can carry `motionScenes` to follow a formula-driven path over time — see §13.
- `math-shape` — formula-driven parametric shapes (sine, spiral, circle, ellipse) with `drawProgress`. **See §9 (the `x0`/`y0` convention — required) and §13 (authoring patterns + worked example).**
- `image` — raster, with `src`, `fit`, `offset`
- `video` — type exists in schema; not yet exposed in Add Layer UI
- `kg-shape` — SVG snapshotted from KG graph `vemotion-shapes`
- `card` — card snapshotted from KG graph `vemotion-cards`

---

## 2. How compositions are structured

```ts
type CompositionData = {
  duration: number;       // seconds
  fps: number;            // typically 30
  width: number;          // px (e.g. 1280 or 1920)
  height: number;         // px (e.g. 720 or 1080)
  fontFamily?: string;
  groups?: LayerGroup[];
  layers: Layer[];
};

type Layer = {
  id: string;
  type: 'text' | 'shape' | 'image' | 'video' | 'kg-shape' | 'card' | 'math-shape';
  groupId?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  visible?: boolean;
  startTime?: number;
  layerDuration?: number;
  animation?: Animation;     // single animation (legacy)
  animations?: Animation[];  // multiple (preferred)
  properties: Record<string, unknown>;  // type-specific
};

type Animation = {
  // Discriminator. Defaults to 'layer' when absent (back-compat).
  // See §10 for what each kind does.
  kind?: 'layer' | 'char-stagger' | 'mask-wipe';
  // Required for kind 'layer' and 'char-stagger'; unused for 'mask-wipe'.
  property?: string;          // 'opacity' | 'offsetX' | 'offsetY' | 'scale' | 'drawProgress' | …
  keyframes: { time: number; value: unknown }[];
  // Easing curve applied BETWEEN adjacent keyframes (see §14 for the full
  // table). Default 'easeInOut' for back-compat. Honoured by the renderer.
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  // 'char-stagger' only — seconds of delay between successive characters.
  stagger?: number;
  // 'mask-wipe' only — direction of the reveal.
  direction?: 'ltr' | 'rtl' | 'ttb' | 'btt' | 'radial';
};

type LayerGroup = {
  id: string;
  name: string;
  collapsed?: boolean;
  visible?: boolean;
};
```

### Animation properties supported (for kind = `'layer'`)

- `opacity` — fade-in, fade-out, fade-in-out
- `offsetX` / `offsetY` — slide in/out from edges, bounce
- `scale` — scale-up from small to full size
- `drawProgress` — for `math-shape`, animates the parametric curve draw progress 0 → 1

For non-`layer` kinds (`char-stagger`, `mask-wipe`), see §10.

### Minimal valid composition

From [src/lib/examples.ts:4](../src/lib/examples.ts):

```ts
{
  duration: 5, fps: 30, width: 1280, height: 720,
  layers: [
    { id: 'bg', type: 'shape',
      position: { x: 0, y: 0 }, size: { width: 1280, height: 720 },
      properties: { shape: 'rect', color: '#020617', opacity: 1 } },
    { id: 'title', type: 'text',
      position: { x: 84, y: 34 }, size: { width: 1112, height: 56 },
      properties: { text: 'Movement over Time', fontSize: 34, color: '#e2e8f0',
                    align: 'left', fontWeight: '700', opacity: 1 },
      animation: { property: 'opacity',
                   keyframes: [{ time: 0, value: 0 }, { time: 0.4, value: 1 }] } }
  ]
}
```

---

## 3. Where compositions are stored

Two layers:

- **Local:** `localStorage` key `vemotion:last-composition` holds the most recently opened ref (working draft in the browser).
- **Cloud:** Cloudflare D1 behind the Vemotion Worker at `https://api.vegvisr.org/vemotion/*`. See [src/lib/cloud-compositions.ts](../src/lib/cloud-compositions.ts).

Shape and card assets live in Knowledge Graphs (`vemotion-shapes`, `vemotion-cards`) at `https://knowledge.vegvisr.org`. The animation library lives in `vemotion-animations` — **one KG node = one animation** (see [CLAUDE.md](../CLAUDE.md) for the rules).

---

## 4. Endpoints the agent can call

Base URL: `https://api.vegvisr.org/vemotion`. All endpoints require `X-API-Token` header except `health` and `openapi`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/openapi.json` | Full OpenAPI spec |
| GET | `/compositions` | List user compositions (returns id, name, duration, fps, width, height, layerCount, createdAt, updatedAt, version) |
| GET | `/composition?id=<id>` | Fetch a single composition with full layer/animation data |
| POST | `/composition/save` | Save / update — body `{ id?, name, composition }` |
| POST | `/composition/refit` | Reformat for a new canvas size — body `{ compositionId? \| composition, targetWidth, targetHeight, mode, name? }`. See §12 for the algorithm and curl recipes. |
| DELETE | `/composition?id=<id>` | Delete composition |
| GET | `/projects` | List projects |
| POST | `/project` | Create / update project |
| DELETE | `/project?id=<id>` | Delete project |
| POST | `/render` | Queue render — `{ compositionId? \| composition, format? }` |
| GET | `/render?id=<id>` | Poll render job status |
| GET | `/renders` | List render jobs |

### Asset lookup (read-only, also auth-gated):

- `GET https://knowledge.vegvisr.org/getknowgraph?id=vemotion-shapes`
- `GET https://knowledge.vegvisr.org/getknowgraph?id=vemotion-cards`
- `GET https://knowledge.vegvisr.org/getknowgraph?id=vemotion-animations`

---

## 5. OpenAPI compliance

Yes — two specs available:

- Vemotion Worker: `https://api.vegvisr.org/vemotion/openapi.json`
- Knowledge Graph: `https://knowledge.vegvisr.org/openapi.json`

Both are the source of truth for endpoint contracts. Fetch them before generating client code.

---

## 6. Auth

- **Header:** `X-API-Token: <emailVerificationToken>`
- **Token source:** the user row in D1. In the frontend, it lives at `window.localStorage.user.emailVerificationToken` (88-char hex). See [src/lib/auth.ts:21](../src/lib/auth.ts).
- **Format:** single opaque hex string per user. No OAuth bearer, no JWT.
- **Public endpoints:** only `/health` and `/openapi.json`. Everything else is auth-gated.
- **Dev token** (will be rotated at full prod): `b1ca2967e8165ec02fdf039d9e916af4005f7388`

---

## 7. Worked example — list compositions

```bash
curl -sS -H "X-API-Token: <token>" https://api.vegvisr.org/vemotion/compositions
```

Returns:

```json
{
  "ok": true,
  "compositions": [
    {
      "id": "comp_mp9hg7zz_gmhl5",
      "name": "Fibonacci Spiral Editorial True",
      "duration": 9, "fps": 30, "width": 1280, "height": 720,
      "layerCount": 20, "version": 15,
      "createdAt": "2026-05-17T07:57:54.431Z",
      "updatedAt": "2026-05-17T16:08:58.760Z"
    }
  ],
  "count": 1, "cursor": null, "truncated": false
}
```

To fetch the full composition body (with layers and animations), call `GET /composition?id=<id>`.

---

## 8. Rules the agent must follow

- **One animation per KG node** in `vemotion-animations`. Never bundle.
- For KG graph creation/updates, **always** use `POST https://knowledge.vegvisr.org/saveGraphWithHistory` with `{ id, graphData, override: true }`. Never use `saveknowgraph`, `updateknowgraph`, or `addNode`.
- Composition `version` is returned by the list endpoint but `composition.save` handles version conflicts server-side — pass the `id` to update, omit to create.
- Layer `position` and `size` are in canvas pixels, not normalized.
- Keyframe `time` is in seconds, not frames.

---

## 9. math-shape formulas — the `x0` / `y0` convention

**math-shape `xFormula` and `yFormula` return ABSOLUTE canvas coordinates, not coordinates relative to the layer's `position`.** This is a footgun if you forget — the shape will render in the canvas top-left regardless of what `position.x` / `position.y` say.

To position a math-shape correctly, the formulas **must** reference the per-sample context variables `x0` and `y0`, which the renderer binds to `layer.position.x` / `layer.position.y` before each evaluation.

**Available context variables** (renderer.ts:74–96):

| Var | Meaning |
|---|---|
| `t` | Parametric value, swept from `tStart` to `tEnd` |
| `p` | Normalised progress, `(t - tStart) / (tEnd - tStart)` |
| `start`, `end`, `duration` | The configured `tStart`, `tEnd`, and `tEnd - tStart` |
| `x0`, `y0` | `layer.position.x`, `layer.position.y` — **always prepend these to position the curve** |
| `w`, `h` | `layer.size.width`, `layer.size.height` |
| `sin`, `cos`, `tan`, `abs`, `min`, `max`, `pow`, `sqrt`, `pi` | Math helpers |

**Right** (built-in presets all follow this):

```json
"xFormula": "x0 + w/2 + min(w,h)*0.35*cos(t)",
"yFormula": "y0 + h/2 + min(w,h)*0.35*sin(t)"
```

**Wrong** — renders in the top-left no matter what `position` says:

```json
"xFormula": "t * 60",
"yFormula": "Math.sin(t * 0.8) * 30 + 40"
```

**Fix for an existing broken layer:** prepend `x0 + ` to `xFormula` and `y0 + ` to `yFormula`.

The same convention applies to `motionScenes[].xFormula` / `yFormula` (used by any layer type for procedural motion paths). Quote from a working example:

```json
{ "start": 0, "end": 2.5,
  "xFormula": "x0 + cos(t*2)*120",
  "yFormula": "y0 + sin(t*2)*60" }
```

---

## 10. Animation kinds — `layer`, `char-stagger`, `mask-wipe`

Vemotion's `Animation` is a discriminated union via the `kind` field. Three kinds are supported. **Animations with no `kind` are treated as `'layer'`** so every composition shipped before this addition keeps working.

### `kind: 'layer'` (default)

The classic shape: keyframes interpolate a named layer property over time. Every layer type respects these.

```json
{ "property": "opacity",
  "keyframes": [{ "time": 0, "value": 0 }, { "time": 0.4, "value": 1 }] }
```

Same thing with the explicit kind written out:

```json
{ "kind": "layer",
  "property": "opacity",
  "keyframes": [{ "time": 0, "value": 0 }, { "time": 0.4, "value": 1 }] }
```

### `kind: 'char-stagger'` — per-character text animation

**Text layers only.** The renderer splits `properties.text` into characters at draw time, then applies the keyframes per-character with an offset of `index * stagger` seconds. Supported `property` values:

- `opacity` — Type-on / per-char fade. *Most common.*
- `offsetX` / `offsetY` — char-rise / char-slide.
- `scale` — char-zoom.

`property: 'color'` is **not** implemented in this kind — color interpolation needs string→numeric infra.

```json
{ "kind": "char-stagger",
  "property": "opacity",
  "stagger": 0.05,
  "keyframes": [{ "time": 0, "value": 0 }, { "time": 0.15, "value": 1 }] }
```

That reads as "each character fades in over 150 ms; characters start 50 ms apart in source order." Multi-line wrapped text shares a single global character index, so the second line's first character continues right after the first line's last character.

### `kind: 'mask-wipe'` — animated clip reveal

**Any layer type.** The renderer applies an animated clip path to the whole layer before drawing. Keyframes drive a 0 → 1 reveal progress; `direction` controls geometry.

```json
{ "kind": "mask-wipe",
  "direction": "ltr",
  "keyframes": [{ "time": 0, "value": 0 }, { "time": 1, "value": 1 }] }
```

Directions:

| `direction` | Behaviour |
|---|---|
| `ltr` | Rectangle grows from the layer's left edge rightward |
| `rtl` | Rectangle grows from the layer's right edge leftward |
| `ttb` | Rectangle grows from the layer's top edge downward |
| `btt` | Rectangle grows from the layer's bottom edge upward |
| `radial` | Circle grows from the layer's centre to enclose the corners (iris reveal) |

At `progress = 0` nothing renders; at `progress = 1` the full layer rect is visible. Hand-edit the keyframes to `[{0,1},{1,0}]` to get a wipe-OUT.

`mask-wipe` does **not** use `property`; it uses `direction` instead. The renderer reads only the first `mask-wipe` it finds on a layer if multiple are stacked.

### Stacking and composition

A layer may have one animation in `layer.animation` and any number in `layer.animations[]`. Animations of different kinds compose:

- `char-stagger` on `opacity` + `mask-wipe` `ltr` — characters fade in individually while a left-to-right wipe also reveals them.
- `layer` `opacity` + `mask-wipe` `radial` — the whole layer fades AND iris-reveals.
- `char-stagger` on `offsetY` + `mask-wipe` `ttb` — characters drop in while a top-down wipe reveals them.

Order to attach them: it doesn't matter; the renderer evaluates them on independent axes (layer-property bag, per-char loop, and the layer clip respectively).

---

## 11. Text fill modes — `fillMode` and `fillSource`

A text layer's letterforms can act as a *window onto an image*. This is a static layer property (not an animation) and composes with every animation kind in §10.

Layer property additions (text layers only):

| Property | Type | Default | Meaning |
|---|---|---|---|
| `fillMode` | `'solid' \| 'image'` | `'solid'` | `'solid'` uses `color` as the fill; `'image'` uses `fillSource` clipped to letter shapes |
| `fillSource` | `string` (URL) | — | Required when `fillMode === 'image'` |
| `fillFit` | `'cover' \| 'contain' \| 'fill'` | `'cover'` | How the image is sized into the layer bounds before being clipped to the letters |

Example — title card with a photo visible inside the letters:

```json
{
  "id": "title",
  "type": "text",
  "position": { "x": 80, "y": 200 },
  "size": { "width": 1120, "height": 200 },
  "properties": {
    "text": "EXPLORE",
    "fontSize": 180,
    "fontWeight": "900",
    "align": "center",
    "color": "#ffffff",
    "fillMode": "image",
    "fillSource": "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600",
    "fillFit": "cover"
  }
}
```

### Implementation notes (so agents can reason about edge cases)

- The image must be **CORS-accessible** (`Access-Control-Allow-Origin: *` or an explicit origin). The renderer loads it with `crossOrigin = 'anonymous'`. Failing CORS → image silently doesn't load → text falls back to solid for that frame.
- The renderer renders text into an offscreen canvas, then uses `globalCompositeOperation = 'source-in'` to keep only the image pixels that overlap text. Pure canvas — survives ffmpeg.wasm MP4 export.
- **Shadows are dropped** on the image-fill path. They survived `source-in` as muddy fringes. Solid path still has shadows.
- `fillMode === 'image'` composes with: `globalAlpha` (set by `drawLayer`), `mask-wipe` clip (also `drawLayer`), `char-stagger` (renders into the same offscreen ctx). All three apply correctly to image-filled text.
- The image is fetched once and cached per `CanvasRenderer` instance. Multiple text layers sharing the same `fillSource` URL share the load.

### Common compositions worth knowing

- **Title card, image inside letters:** big bold text + `fillMode: 'image'` + `fillSource: <url>` + a `mask-wipe` animation = the *Gladiator* opener.
- **Lyric video word reveals:** image-filled text + `char-stagger` opacity = each character fades in as a window onto the video frame.
- **Logo lockup:** image-filled text with a static `fillSource` and no animations = a wordmark with photographic fill.

---

## 12. Reformatting a composition for a new aspect (refit)

When a composition authored for one canvas size (e.g. `1280×720` landscape) needs to be reformatted for another (e.g. `1080×1080` Instagram Square or `1080×1920` Reels), simply changing `composition.width` / `height` is not enough — every layer still has its original absolute pixel `position` and `size`, so the content ends up clipped, mispositioned, or surrounded by black.

**There is a client-side modal in the editor** ("Refit layers to canvas…") that performs this transformation, but the algorithm below is also the canonical recipe an agent should follow when producing a reformatted composition over the API. The logic lives in [src/lib/refit.ts](../src/lib/refit.ts).

### Three modes

| Mode | Uniform scale? | Offsets | Result |
|---|---|---|---|
| `fit` | yes, `s = min(targetW/oldW, targetH/oldH)` | centred, positive on the longer axis | letterbox bars on the longer axis; everything visible |
| `fill` | yes, `s = max(targetW/oldW, targetH/oldH)` | centred, negative on the shorter axis | no bars; content fills the frame, edges may clip — **default for most reformats** |
| `stretch` | no, `sx = targetW/oldW`, `sy = targetH/oldH` | `0, 0` | no bars, no clipping, but circles become ellipses and text gets squashed |

### Algorithm

For each layer, compute the new geometry:

```
sx       = (mode === 'stretch') ? targetW / oldW : s
sy       = (mode === 'stretch') ? targetH / oldH : s
offsetX  = (mode === 'stretch') ? 0 : (targetW - oldW * s) / 2
offsetY  = (mode === 'stretch') ? 0 : (targetH - oldH * s) / 2

layer.position.x' = layer.position.x * sx + offsetX
layer.position.y' = layer.position.y * sy + offsetY
layer.size.width'  = layer.size.width  * sx
layer.size.height' = layer.size.height * sy
```

### Properties to scale uniformly

Beyond `position` / `size`, scale these numeric properties (if present) by `fontScale = min(sx, sy)`:

- `fontSize`, `titleFontSize`, `bodyFontSize`
- `strokeWidth`
- `padding`, `gap`, `borderRadius`

For `stretch` mode, `min(sx, sy)` keeps text legible inside whatever the squished layer rect becomes.

### Animation keyframe scaling

Scale only the pixel-valued animation properties:

| `animation.property` | Scale `keyframe.value` by |
|---|---|
| `offsetX` | `sx` |
| `offsetY` | `sy` |
| anything else (`opacity`, `scale`, `drawProgress`, …) | — leave untouched |

For `kind: 'char-stagger'`, scale per the same rule (the per-glyph offsets ride the layer's own scaling, so it Just Works).

For `kind: 'mask-wipe'`, leave untouched — `direction` is geometric, keyframes drive a 0..1 progress, neither is a pixel quantity.

### Known limitations

- **math-shape formulas with hard-coded pixel constants** (e.g. `xFormula: "x0 + t * 60"`, `yFormula: "y0 + sin(t*0.8) * 30 + 40"`) **don't auto-scale**. Only references to `x0`, `y0`, `w`, `h` adapt. To make a math-shape refit cleanly, author its formula in terms of `w` / `h` percentages instead of pixels — e.g. `x0 + p * w` instead of `x0 + t * 60`.
- **`motionScenes` formulas** have the same limitation.
- **`fillSource` images** aren't re-fetched at a new resolution; the renderer cover-fits them at runtime, so this is usually fine, but a tight crop authored for one aspect will shift.

### Worked example — landscape → Instagram Square (1280×720 → 1080×1080, fill mode)

```
sx = sy = max(1080/1280, 1080/720) = max(0.844, 1.500) = 1.500
offsetX = (1080 - 1280 * 1.500) / 2 = (1080 - 1920) / 2 = -420
offsetY = (1080 -  720 * 1.500) / 2 = (1080 - 1080) / 2 =    0

Layer originally at position {x:80, y:40}, size {w:1120, h:60}:
  position' = { x: 80*1.5 + (-420), y: 40*1.5 + 0 } = { x: -300, y: 60 }
  size'     = { w: 1120*1.5, h: 60*1.5 }            = { w: 1680, h: 90 }
```

The negative x at -300 clips the left side of that layer in the new canvas — expected for `fill` mode going from wider to square.

### Endpoint — `POST /vemotion/composition/refit`

The algorithm is exposed as an HTTP endpoint on the worker so other clients (e.g. `agent.vegvisr.org`) don't need to re-implement the math. Two input shapes, two output shapes — pick a combination from the matrix below.

| Input | Output (no `name`) | Output (with `name`) |
|---|---|---|
| `compositionId` (saved comp; owner check applies) | `200 { ok, composition }` (pure transform, source untouched) | `201 { ok, id, summary, version }` (saved as NEW row; source untouched) |
| `composition` (inline body) | `200 { ok, composition }` (pure transform) | `201 { ok, id, summary, version }` (saved as NEW row) |

Required fields: exactly one of `compositionId` / `composition`, plus `targetWidth`, `targetHeight`, `mode`. `name` is optional and toggles the save path.

Inline refit (no save) — useful when an agent just wants the transformed body to feed downstream:

```bash
curl -sS -X POST https://api.vegvisr.org/vemotion/composition/refit \
  -H "X-API-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "composition": {
      "duration": 5, "fps": 30, "width": 1280, "height": 720,
      "layers": [
        { "id": "title", "type": "text",
          "position": { "x": 80, "y": 40 }, "size": { "width": 1120, "height": 60 },
          "properties": { "text": "Hello", "fontSize": 48 } }
      ]
    },
    "targetWidth": 1080, "targetHeight": 1080, "mode": "fill"
  }'
# → 200 { ok: true, composition: { width: 1080, height: 1080, layers: [...] } }
```

Save-mode refit (creates a NEW composition; source row, if any, is not modified):

```bash
curl -sS -X POST https://api.vegvisr.org/vemotion/composition/refit \
  -H "X-API-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "compositionId": "comp_mp9hg7zz_gmhl5",
    "targetWidth": 1080, "targetHeight": 1080, "mode": "fill",
    "name": "Fibonacci Spiral — Square"
  }'
# → 201 { ok: true, id: "comp_…new…", summary: { … }, version: 1 }
```

---

## 13. Authoring math-shapes and motion paths

Two related formula systems in Vemotion. Both use the same evaluator and the same variable vocabulary (see §9 table).

### 13.1 — Math-shape layer: a parametric curve

A `math-shape` layer draws a curve traced by `(xFormula(t), yFormula(t))` as `t` sweeps from `tStart` to `tEnd`. The renderer samples `samples` points along the range, joins them with lines, and strokes the result. `drawProgress` (0 → 1) controls how much of the curve is currently drawn (use a keyframed `layer` animation on `drawProgress` for "write-on" reveals).

Required fields in `properties`:

| Field | Type | Notes |
|---|---|---|
| `mathKind` | `'parametric'` | Only kind today. |
| `xFormula` | string | Returns absolute canvas X. **Prepend `x0`** (see §9). |
| `yFormula` | string | Returns absolute canvas Y. **Prepend `y0`**. |
| `tStart` | number | Default 0. |
| `tEnd` | number | Default `2π` (`6.283185…`). Use 1 for "normalized" formulas that drive on `p` instead of `t`. |
| `samples` | integer | 12–720. Higher = smoother. 180 is a good default for closed shapes. |
| `stroke` | string | Stroke color hex. Aliased to `color` if `stroke` is absent. |
| `strokeWidth` | number | Pixels. |
| `fill` | string \| null | Optional fill color; only applied when `closePath: true` and `drawProgress >= 1`. |
| `closePath` | boolean | Default `true`. Close the curve back to the start when fully drawn. |
| `drawProgress` | number `0..1` | Default 1. Keyframe-animate this for a write-on reveal. |

Reusable formula patterns (same set the editor preset dropdown uses):

```jsonc
// Circle (radius 35% of min dimension, centred in the layer's bounding box)
{ "xFormula": "x0 + w/2 + min(w,h)*0.35 * cos(t)",
  "yFormula": "y0 + h/2 + min(w,h)*0.35 * sin(t)",
  "tStart": 0, "tEnd": 6.283185, "samples": 180, "closePath": true }

// Ellipse (independent x/y radii)
{ "xFormula": "x0 + w/2 + w*0.35 * cos(t)",
  "yFormula": "y0 + h/2 + h*0.22 * sin(t)",
  "tStart": 0, "tEnd": 6.283185, "samples": 180, "closePath": true }

// Sine wave across the layer (uses p = normalised progress, tEnd=1)
{ "xFormula": "x0 + p*w",
  "yFormula": "y0 + h/2 + sin(p*pi*4) * h*0.25",
  "tStart": 0, "tEnd": 1, "samples": 220, "closePath": false }

// Spiral (radius grows with t)
{ "xFormula": "x0 + w/2 + (t/(pi*6)) * min(w,h)*0.4 * cos(t)",
  "yFormula": "y0 + h/2 + (t/(pi*6)) * min(w,h)*0.4 * sin(t)",
  "tStart": 0, "tEnd": 18.849, "samples": 240, "closePath": false }
```

### 13.2 — Motion paths on any layer: `motionScenes`

`motionScenes` is an optional property on **any** layer type (text, shape, image, math-shape, kg-shape, card). Each scene defines a time window and the formula(s) that drive the layer's position — and optionally scale — during that window:

```ts
type MotionScene = {
  start: number;          // seconds (in composition time)
  end: number;            // seconds
  xFormula?:     string;  // returns absolute canvas X for the layer's top-left
  yFormula?:     string;  // returns absolute canvas Y for the layer's top-left
  scaleFormula?: string;  // returns scale (1 = native size). OVERRIDES any keyframe/static scale during the scene window.
};
```

Semantics:
- When the current time `t` is inside `[start, end]`, the renderer evaluates each formula that's present and overrides the corresponding layer state:
  - `xFormula` / `yFormula` → set `offsetX` / `offsetY` so the layer's visual position equals the formula output.
  - `scaleFormula` → replaces the layer's `scale` for the duration of the scene window. Compose with the position formulas in one place — e.g. an orbiting dot that also grows/shrinks.
- Outside the scene window, the layer renders at its base `position` and whatever scale the keyframe / static property gives it.
- Multiple scenes can stitch together: the FIRST scene whose window contains the current time is used. To make a smooth multi-segment path, ensure consecutive scenes meet at the same `(x, y)` at the join.
- Same evaluator as math-shape — same variables: `t` (seconds since scene start), `p` (normalised 0..1 across the scene), `x0`, `y0`, `w`, `h`, `sin`, `cos`, `tan`, `pi`, etc.
- `scaleFormula` example shapes:
  - **Sine-wave pulse** (one cycle per scene): `"1 + 0.5 * sin(p * 2 * pi)"` — scale oscillates between 0.5 and 1.5.
  - **Pulse N times per scene**: `"1 + 0.5 * sin(p * N * 2 * pi)"`.
  - **Grow linearly**: `"1 + p * 2"` — starts at 1, ends at 3.
  - **Heartbeat (asymmetric)**: `"1 + 0.3 * abs(sin(p * 2 * pi * 4))"` — sharper peaks via `abs()`.

### 13.3 — Worked example: small circle orbiting a larger circle's edge

A small dot traces the outline of a centred large circle once over 5 seconds. The large circle is a `math-shape` (showing parametric authoring); the small dot is a regular `shape: 'circle'` with `motionScenes` (showing motion paths on a non-math-shape).

**The math:** the large circle is centred at canvas centre `(640, 360)` with radius `200`. The small dot's CENTRE needs to trace `(640 + 200·cos(angle), 360 + 200·sin(angle))` where `angle` sweeps `0 → 2π` over the scene.

We anchor the small dot's BASE `position` at the canvas centre (so the dot's top-left, given a 30×30 dot, sits at `(640-15, 360-15) = (625, 345)`). Then the formula `x0 + 200 * cos(p * 2 * pi)` traces a full revolution at radius 200 around the centre. `p` is normalised 0..1 across the scene — `p * 2 * pi` sweeps the full rotation regardless of scene duration.

```jsonc
{
  "duration": 5, "fps": 30, "width": 1280, "height": 720,
  "layers": [
    // — Background —
    {
      "id": "bg",
      "type": "shape",
      "position": { "x": 0, "y": 0 },
      "size":     { "width": 1280, "height": 720 },
      "properties": { "shape": "rect", "color": "#0f172a" }
    },

    // — Large circle: math-shape, parametric circle, drawn over the first
    //   0.8 s for a "write-on" reveal, then stays full —
    {
      "id": "large-circle",
      "type": "math-shape",
      "position": { "x": 440, "y": 160 },   // top-left of 400x400 bbox centred at (640, 360)
      "size":     { "width": 400, "height": 400 },
      "animation": {
        "property": "drawProgress",
        "keyframes": [
          { "time": 0,   "value": 0 },
          { "time": 0.8, "value": 1 }
        ]
      },
      "properties": {
        "mathKind":    "parametric",
        "xFormula":    "x0 + w/2 + 200 * cos(t)",
        "yFormula":    "y0 + h/2 + 200 * sin(t)",
        "tStart":      0,
        "tEnd":        6.283185,
        "samples":     180,
        "stroke":      "#94a3b8",
        "strokeWidth": 3,
        "fill":        null,
        "closePath":   true,
        "drawProgress": 1
      }
    },

    // — Small orbiting dot: regular shape:circle, base position at canvas
    //   centre, motionScenes drives its top-left around the circle edge —
    {
      "id": "orbiter",
      "type": "shape",
      "position": { "x": 625, "y": 345 },   // top-left of 30x30 dot centred at (640, 360)
      "size":     { "width": 30, "height": 30 },
      "properties": {
        "shape": "circle",
        "color": "#38bdf8",
        "motionScenes": [
          {
            "start": 0,
            "end":   5,
            "xFormula": "x0 + 200 * cos(p * 2 * pi)",
            "yFormula": "y0 + 200 * sin(p * 2 * pi)"
          }
        ]
      }
    }
  ]
}
```

**Reading the formulas:**
- `x0` is bound to the small dot's `position.x` = 625 (its top-left). Plus `200·cos(p·2π)` traces a circle of radius 200 around that anchor.
- `p` is normalised progress 0..1 over the scene `[0, 5]` seconds. At `p = 0` the dot is at the 3-o'clock position (`cos(0) = 1`); at `p = 0.25` it's at 6-o'clock (`cos(π/2) = 0, sin(π/2) = 1`); etc.
- To orbit in the OPPOSITE direction: negate the y formula → `y0 - 200 * sin(p * 2 * pi)`. To start at 12-o'clock: shift the angle → `... cos(p * 2 * pi - pi/2)`.
- To make the orbit complete 3 revolutions in 5 s: replace `p * 2 * pi` with `p * 6 * pi` (or `p * 3 * 2 * pi`).
- To match a different radius, replace BOTH `200` constants (in xFormula and yFormula). The large circle's apparent radius is `200` because that's the constant inside its xFormula/yFormula too — they must be kept in sync manually. (`refit` won't auto-scale these — see §12 known limitations.)

**Saving via the API:**

```bash
curl -sS -X POST https://api.vegvisr.org/vemotion/composition/save \
  -H "X-API-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Orbiter example", "composition": { … paste the composition above … } }'
# → 201 { ok: true, id: "comp_…", summary: { … }, version: 1 }
```

Then open the editor at `https://vemotion.vegvisr.org/?compositionId=<id>` and press Play — the dot orbits the circle's edge for the full 5 seconds, then loops.

### 13.3b — Variant: orbiter that also pulses size

Same orbiter as above with one extra `scaleFormula` so the dot grows and shrinks twice per revolution. Position and size are driven in a single `motionScenes` entry:

```jsonc
{
  "id": "orbiter",
  "type": "shape",
  "position": { "x": 625, "y": 345 },
  "size":     { "width": 30, "height": 30 },
  "properties": {
    "shape": "circle",
    "color": "#38bdf8",
    "motionScenes": [
      {
        "start": 0, "end": 5,
        "xFormula":     "x0 + 200 * cos(p * 2 * pi)",
        "yFormula":     "y0 + 200 * sin(p * 2 * pi)",
        "scaleFormula": "1 + 0.5 * sin(p * 4 * pi)"
      }
    ]
  }
}
```

Reading the `scaleFormula`:
- `p` is normalised 0..1 across the scene.
- `p * 4 * pi` sweeps two full sine periods (`4π = 2·2π`).
- `0.5 * sin(...)` gives a wave in `[-0.5, +0.5]`.
- `1 + 0.5 * sin(...)` is therefore in `[0.5, 1.5]` — the dot scales between half and 1.5× its native size, twice per orbit.

Substitute `p * 2 * pi` for one pulse per orbit, `p * 6 * pi` for three, etc.

Composing with a `scale` keyframe animation: `scaleFormula` OVERRIDES any keyframe scale during the scene window (same rule as `xFormula`/`yFormula` override position). Outside the window, the keyframe value applies again.

### 13.4 — Common patterns for motion formulas

| Effect | xFormula | yFormula |
|---|---|---|
| Straight line A → B (top-left anchored at A) | `x0 + p * (B.x - A.x)` | `y0 + p * (B.y - A.y)` |
| Circle / orbit at radius R around anchor | `x0 + R * cos(p * 2 * pi)` | `y0 + R * sin(p * 2 * pi)` |
| Vertical oscillation (amplitude A, N cycles) | `x0` (or `x0 + p*w` for horizontal drift) | `y0 + A * sin(p * N * 2 * pi)` |
| Bezier-ish ease via squared p | `x0 + p*p * (B.x - A.x)` | `y0 + p*p * (B.y - A.y)` |
| Spiral inward to anchor | `x0 + (1-p) * R * cos(p * N * 2 * pi)` | `y0 + (1-p) * R * sin(p * N * 2 * pi)` |
| Sine wave horizontal traversal | `x0 + p*w` | `y0 + h/2 + h*0.3 * sin(p * 4 * pi)` |

For all of these, set the layer's base `position` such that the FORMULA OUTPUT for `p = 0` matches where you want the layer to start. The renderer evaluates the formula and translates the layer there; `position` is the anchor everything is relative to.

---

## 14. Keyframes — the timing primitive every animation rests on

`keyframes` is the universal contract for time-based change across every animation `kind` (`layer`, `char-stagger`, `mask-wipe`) and `motionScenes`. Same shape, same evaluator, predictable boundary behaviour. If `keyframes` is in scope, this section defines what it means.

### 14.1 — Authoring contract

```ts
type Keyframe = {
  time: number;     // SECONDS, in the layer's LOCAL time (relative to layer.startTime).
  value: unknown;   // For animatable numeric properties this is a number.
                    // String values (e.g. colour) are NOT interpolated today —
                    // only the values at exact keyframe times are honoured,
                    // intermediate frames clamp to the previous keyframe.
};
```

Rules:
- **`time` is in seconds, local to the layer's `startTime`.** A keyframe at `time: 0` triggers when the layer first becomes active (i.e. at composition time `= layer.startTime`).
- **The array can be in any order.** The renderer sorts by `time` ascending before evaluating, so the JSON can be written in whatever order is most readable.
- **Anchor the LAST keyframe at the layer's effective duration** if you want the value to "settle" cleanly when the layer ends. Otherwise the value is held constant past the last keyframe (boundary clamp — see §14.3).
- **Numbers, please.** `opacity`, `offsetX`, `offsetY`, `scale`, `drawProgress`, `mask-wipe` reveal progress, `char-stagger`'s targeted property — all numeric. The renderer interpolates linearly between them then applies the easing curve.

### 14.2 — Easing (`easing` field)

`Animation.easing` controls the curve applied between adjacent keyframes. Honoured by the renderer.

| Mode | Curve | Use when |
|---|---|---|
| `'easeInOut'` *(default)* | `t < 0.5 ? 2t² : 1 − 2(1−t)²` | The standard "natural" feel. Slow start, fast middle, slow end. Default for back-compat — animations authored without an `easing` field continue to behave as before. |
| `'linear'` | `t` | Constant rate of change. Use for mechanical motion, looping cycles, or when you want predictable per-segment speed (e.g. a metronome tick or a uniformly-rotating element). |
| `'easeIn'` | `t²` | Slow start, fast finish. Use for "departures" — a layer accelerating off-screen. |
| `'easeOut'` | `1 − (1−t)²` | Fast start, slow finish. Use for "arrivals" — a layer decelerating into its final position. |

The curve is applied **per segment** (between each pair of adjacent keyframes), not across the whole animation. A 5-keyframe bounce with `easing: 'easeInOut'` eases between kf1↔kf2, then again between kf2↔kf3, etc.

### 14.3 — Boundary behaviour

```
time < first keyframe.time   →  value = first keyframe.value (CLAMP)
time = first keyframe.time   →  value = first keyframe.value (exact)
time between adjacent kfs    →  value = lerp + easing
time = last keyframe.time    →  value = last keyframe.value (exact)
time > last keyframe.time    →  value = last keyframe.value (CLAMP, NOT extrapolation)
```

**The renderer never extrapolates past the last keyframe.** It holds the last value indefinitely until either the layer ends or the next kind of override kicks in (e.g. a `motionScenes` window). Practical consequence: a fade-in animation `[{0,0}, {0.4,1}]` on a layer whose `layerDuration` is 3 s will fade in over the first 0.4 s and STAY at opacity 1 for the remaining 2.6 s. No need to add a trailing `{3, 1}` keyframe to keep the layer visible.

### 14.4 — Multi-keyframe authoring patterns

| Pattern | Shape | When to use |
|---|---|---|
| **Single segment** (fade, slide, scale-up) | `[{0, A}, {t1, B}]` | One-shot reveal or exit. Most common. |
| **Settle after move** | `[{0, A}, {t1, B}, {layerDuration, B}]` | A `0→B` move followed by an explicit hold (rarely needed thanks to boundary clamp, but useful for clarity). |
| **Bounce there-and-back** | `[{0, 0}, {t/2, peak}, {t, 0}]` | Vertical hop, pulse, breathing scale. |
| **Oscillation (N cycles)** | `[{0,0}, {t/2N, +A}, {t/N, 0}, {3t/2N, -A}, {2t/N, 0}, …]` ending at `{t, 0}` | Wobble, jitter, pendulum. |
| **Dwell-then-move-then-dwell** | `[{0, A}, {t1, A}, {t2, B}, {layerDuration, B}]` | Layer holds at A, transitions to B over `t1→t2`, then holds at B. |
| **Asymmetric three-stage** | `[{0, A}, {t1, B}, {t2, C}]` with non-uniform `t1`, `t2` | Choreographed sequences where each segment has its own duration. |

### 14.5 — Worked example: triple-bounce dot (asymmetric multi-segment)

This is `dot-6` from a real composition — 7 keyframes drive a vertical oscillation with three distinct amplitudes over 5 s. Reads as: "two full bounces (down) of equal amplitude, then one big up-bounce, then settle."

```jsonc
{
  "id": "dot-6",
  "type": "shape",
  "position": { "x": 800, "y": 310 },
  "size":     { "width": 8, "height": 8 },
  "startTime": 0,
  "layerDuration": 5,
  "properties": { "shape": "circle", "color": "#f38181", "opacity": 1 },
  "animation": {
    "kind": "layer",
    "property": "offsetY",
    "keyframes": [
      { "time": 0,     "value":  0   },   // start at rest
      { "time": 0.833, "value": -90  },   // peak of up-bounce #1
      { "time": 1.667, "value":  0   },   // back to rest
      { "time": 2.5,   "value":  90  },   // peak of down-bounce
      { "time": 3.334, "value":  0   },   // back to rest
      { "time": 4.167, "value": -90  },   // peak of up-bounce #2
      { "time": 5,     "value":  0   }    // settle exactly at layer end
    ]
  }
}
```

Reading it:
- **Six 0.833 s segments** (5 s / 6 = 0.833) divide the timeline evenly. Each segment uses the default `easeInOut`, so the dot decelerates into each peak / rest position.
- **`offsetY` semantics:** negative = up (canvas Y axis points down). So `-90` is 90 px above the base position.
- **The last keyframe `{5, 0}` is critical** — it anchors the dot back at rest exactly when the layer ends. Without it, the dot would interpolate to the previous keyframe value and then clamp there, leaving the dot 90 px above its base for the final frame.
- **Linear instead of eased?** Change `easing` on the animation to `'linear'` for a mechanical sawtooth feel. The peaks become pointy instead of rounded.

### 14.6 — Common authoring mistakes

- **Putting `time` in frames.** It's seconds. `{ time: 30 }` on a 30 fps composition means "30 seconds from layer start", not "frame 30 (= 1 second)".
- **Forgetting the layer's `startTime` shifts the time origin.** A keyframe at `time: 0` on a layer with `startTime: 2` fires at composition time 2 s, not 0 s.
- **Expecting extrapolation past the last keyframe.** Doesn't happen — value clamps. If you want continued motion, add more keyframes.
- **Using `easing: 'easeOut'` and wondering why the curve still has acceleration at the start.** Easing applies PER SEGMENT, not across the whole animation. A 5-segment animation with `easeOut` eases each segment independently — each segment starts fast and ends slow.
- **Authoring `value` as a string for a numeric property.** The renderer coerces via `Number()` in some paths but generally expects numbers. `{ time: 0, value: "0" }` is fragile — write `value: 0`.
- **Trying to animate `color` via keyframes.** Not implemented today. Colour interpolation needs string→numeric infra (hex parse + per-channel interpolation). Documented limitation.

---

## 15. Worked composition: Venn-style overlap + choreographed dots

A real composition pattern that mixes several primitives at once. Demonstrates:

1. **Translucent overlapping `shape:circle` layers** stacked to create the visual depth of a Venn-style diagram. Each circle has both `color` (the translucent fill) and `strokeColor` + `strokeWidth` (a fully-opaque outline at the same colour, which gives the disc a defined edge against the soft fill).
2. **A `text` layer rendered above the shapes** as a title — the layer-drawing-order convention (later = on top).
3. **Multiple coordinated `shape:circle` "dots"** scattered around the canvas, each driven by an independent `offsetY` keyframe sequence with different amplitudes and timings — choreography by stagger rather than by formula.
4. **A `math-shape` "drawing dot"** with `drawProgress` keyframe-animated 0 → 1, so its outline writes itself on during the first portion of the composition. Mixes parametric shapes with primitive shapes in one composition.

Anatomy below is a focused subset — three Venn circles, three bouncing dots, one drawing dot, one title — 5 s @ 30 fps, 1280×720. Scaling up to 5 circles and 7 dots (the full real-world composition the patterns came from) is mechanical.

```jsonc
{
  "duration": 5, "fps": 30, "width": 1280, "height": 720,
  "fontFamily": "Inter",
  "layers": [
    // —— Venn-style overlapping circles ——
    // Each: translucent fill + opaque outline at the same colour for a
    // defined edge. Three circles overlapping at a shared region.
    {
      "id": "venn-a", "type": "shape",
      "position": { "x": 380, "y": 200 }, "size": { "width": 280, "height": 280 },
      "properties": {
        "shape": "circle",
        "color": "#ff6b6b", "opacity": 0.3,
        "strokeColor": "#ff6b6b", "strokeWidth": 2
      }
    },
    {
      "id": "venn-b", "type": "shape",
      "position": { "x": 620, "y": 200 }, "size": { "width": 280, "height": 280 },
      "properties": {
        "shape": "circle",
        "color": "#4ecdc4", "opacity": 0.3,
        "strokeColor": "#4ecdc4", "strokeWidth": 2
      }
    },
    {
      "id": "venn-c", "type": "shape",
      "position": { "x": 500, "y": 320 }, "size": { "width": 280, "height": 280 },
      "properties": {
        "shape": "circle",
        "color": "#95e1d3", "opacity": 0.3,
        "strokeColor": "#95e1d3", "strokeWidth": 2
      }
    },

    // —— Title (drawn after circles → renders on top) ——
    {
      "id": "title", "type": "text",
      "position": { "x": 390, "y": 40 }, "size": { "width": 500, "height": 80 },
      "properties": {
        "text": "Community",
        "fontSize": 48, "fontFamily": "Inter",
        "color": "#e2e8f0",
        "align": "center", "fontWeight": "700"
      }
    },

    // —— Three bouncing dots, each with a different vertical amplitude
    //     and a different cycle count. Same evaluation kind (layer +
    //     offsetY) — keyframe arrays are what makes them look different. ——
    {
      "id": "dot-small", "type": "shape",
      "position": { "x": 200, "y": 310 }, "size": { "width": 6, "height": 6 },
      "properties": { "shape": "circle", "color": "#9f831d", "opacity": 1 },
      "animation": {
        "kind": "layer", "property": "offsetY",
        "keyframes": [
          { "time": 0,    "value":   0 },
          { "time": 1.25, "value": -67 },
          { "time": 2.5,  "value":   0 },
          { "time": 3.75, "value":  67 },
          { "time": 5,    "value":   0 }
        ]
      }
    },
    {
      "id": "dot-mid", "type": "shape",
      "position": { "x": 250, "y": 310 }, "size": { "width": 8, "height": 8 },
      "properties": { "shape": "circle", "color": "#b94b4b", "opacity": 1 },
      "animation": {
        "kind": "layer", "property": "offsetY",
        "keyframes": [
          { "time": 0,    "value":    0 },
          { "time": 1.25, "value": -147 },
          { "time": 2.5,  "value":    0 },
          { "time": 3.75, "value":  147 },
          { "time": 5,    "value":    0 }
        ]
      }
    },
    {
      "id": "dot-big", "type": "shape",
      "position": { "x": 300, "y": 310 }, "size": { "width": 10, "height": 10 },
      "properties": { "shape": "circle", "color": "#c65d5d", "opacity": 1 },
      "animation": {
        "kind": "layer", "property": "offsetY",
        "easing": "linear",
        "keyframes": [
          { "time": 0,     "value":    0 },
          { "time": 1.667, "value": -120 },
          { "time": 3.334, "value":    0 },
          { "time": 5,     "value":    0 }
        ]
      }
    },

    // —— Drawing dot: a math-shape circle that "writes itself on" over
    //     the first 3.2 s via keyframed drawProgress 0 → 1. ——
    {
      "id": "drawing-dot", "type": "math-shape",
      "position": { "x": 900, "y": 270 }, "size": { "width": 80, "height": 80 },
      "animation": {
        "property": "drawProgress",
        "keyframes": [
          { "time": 0,   "value": 0 },
          { "time": 3.2, "value": 1 }
        ]
      },
      "properties": {
        "mathKind": "parametric",
        "xFormula": "x0 + w/2 + min(w,h)*0.35*cos(t)",
        "yFormula": "y0 + h/2 + min(w,h)*0.35*sin(t)",
        "tStart": 0, "tEnd": 6.283185, "samples": 180,
        "stroke": "#ffffff", "strokeWidth": 3,
        "fill": null, "closePath": true
      }
    }
  ]
}
```

### Why each pattern shows up

- **Translucent fill + matching opaque stroke** (`opacity: 0.3` on the fill colour, `strokeColor` at the same hex). The fill softens the disc; the stroke draws a clean edge. Without the stroke each disc would be a fuzzy gradient blob; without the translucent fill the Venn overlap regions wouldn't blend visually. Both are needed for the Venn look.
- **Layer ordering = z-order.** The title is placed after the three Venn circles in the `layers` array, so it renders ON TOP. Reversing the order would put it behind the discs.
- **Coordinated dots via independent keyframe arrays.** All three dots share the same `kind: 'layer'` / `property: 'offsetY'` shape. Each has DIFFERENT timing (`dot-small`: 4 segments of equal length; `dot-big`: 3 segments + a settle, with `easing: 'linear'`). Mixing `easeInOut` (default) and `'linear'` gives different "feel" per dot without changing the choreography pattern.
- **A `math-shape` next to primitive shapes.** Same composition can mix shape `kind`s. The drawing-dot demonstrates `drawProgress` as a temporal effect that primitive `shape:circle` doesn't have — useful when you want "writes itself on" mid-composition without keyframing every property.
- **Settle at `layerDuration`.** Every dot's last keyframe is anchored at `time: 5` (the composition duration), value 0 — so each dot returns to rest before the composition loops, instead of clamping at a peak position.

### Scaling this pattern up

The real-world composition this came from has **5** Venn circles (red, teal, mint, salmon, lavender — clustered around a centre point with offsets of ±80 px in each axis to form the classic 5-set Venn arrangement) and **7** dots (3 on the left of the circles, 4 on the right) with mixed amplitudes / cycle counts. The recipe is mechanical: add more layers with the same shape, vary `position.x` / `position.y`, and pick non-identical keyframe arrays so the dots don't all bounce in lockstep.

For an interactive runnable example, save the JSON above via:

```bash
curl -sS -X POST https://api.vegvisr.org/vemotion/composition/save \
  -H "X-API-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Venn + dots example", "composition": { … paste the JSON above … } }'
```

Then open at `https://vemotion.vegvisr.org/?compositionId=<returned-id>`.

Error codes: 400 (missing required field / invalid mode / both compositionId+composition / inline composition missing width/height/layers), 403 (compositionId belongs to another user), 404 (compositionId not found).
