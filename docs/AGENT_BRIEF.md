# Vemotion Composition Briefing (for an AI agent)

System prompt / context document for an agent that creates and edits Vemotion compositions programmatically. Grounded in source files in this repo as of 2026-05-23.

---

## 1. What composition types are available

There is **one** unified `CompositionData` shape — no separate templates. Variation comes from **layer types** inside it. Defined in [src/lib/api.ts:1–48](../src/lib/api.ts).

Layer `type` discriminators (the agent must use one of these):

- `text` — text with `fontSize`, `color`, `align`, `fontWeight`, `fontFamily`
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
  property: string;          // 'opacity' | 'offsetX' | 'offsetY' | 'scale' | 'drawProgress'
  keyframes: { time: number; value: unknown }[];
  easing?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';
};

type LayerGroup = {
  id: string;
  name: string;
  collapsed?: boolean;
  visible?: boolean;
};
```

### Animation properties supported

- `opacity` — fade-in, fade-out, fade-in-out
- `offsetX` / `offsetY` — slide in/out from edges, bounce
- `scale` — scale-up from small to full size
- `drawProgress` — for `math-shape`, animates SVG path drawing

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
