# Vemotion Composition Briefing (for an AI agent)

System prompt / context document for an agent that creates and edits Vemotion compositions programmatically. Grounded in source files in this repo as of 2026-05-23.

---

## 1. What composition types are available

There is **one** unified `CompositionData` shape — no separate templates. Variation comes from **layer types** inside it. Defined in [src/lib/api.ts:1–48](../src/lib/api.ts).

Layer `type` discriminators (the agent must use one of these):

- `text` — text with `fontSize`, `color`, `align`, `fontWeight`, `fontFamily`. **Image-fill (letters become a window onto an image): see §11.**
- `shape` — primitives (`rect`, `circle`, `ellipse`, `polygon`) with `color`, `opacity`
- `math-shape` — formula-driven parametric shapes (sine, spiral, circle, ellipse) with `drawProgress`. **See §9 — formulas must prepend `x0` / `y0` to position relative to the layer; otherwise the shape renders in the canvas top-left.**
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
  easing?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';
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
