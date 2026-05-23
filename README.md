# Vemotion — Browser-Native Video Generator

Vemotion is a fully open source, browser-native video generation system that runs entirely on Cloudflare. There is no Node.js server, no headless Chromium, and no FFmpeg process. The browser renders every frame using the HTML5 Canvas API and exports MP4 files using ffmpeg.wasm — no server required.

## Project Documentation

- [CLAUDE.md](./CLAUDE.md) — Project-specific Claude Code instructions
- [docs/AGENT_BRIEF.md](./docs/AGENT_BRIEF.md) — Vemotion composition schema, endpoints, and auth (for AI agents authoring compositions)

## Why this exists

Remotion, the popular React-based video library, requires Node.js, headless Chromium, and a persistent server process. None of that is compatible with a Cloudflare-native edge architecture. Vemotion was built to answer a simple question:

> Can we build a composable, AI-assisted video generation system that is lightweight, fully open source, exposes open APIs, runs entirely on Cloudflare with the browser doing the rendering, and produces high-quality MP4s?

**Answer: Yes.** MP4 export via ffmpeg.wasm was proven working in the browser.

---

## What is proven

- JSON composition → HTML5 Canvas rendering
- Keyframe animation with easeInOut interpolation
- Multiple layer types: text, shape, kg-shape (SVG), card
- Real-time playback via `requestAnimationFrame`
- MP4 export via ffmpeg.wasm — fully browser-based, no server needed
- Composition storage via Cloudflare KV
- AI-assisted layer generation via Cloudflare Workers AI
- Open API endpoints callable by any agent or external system

---

## Architecture

```
Browser (React + Canvas)
  ├── Canvas renderer      src/lib/renderer.ts
  ├── ffmpeg.wasm export   src/lib/exporter.ts
  └── Cloudflare Worker ── KV  (compositions)
                       ├── R2  (video files)
                       ├── D1  (user auth)
                       └── Workers AI (layer generation)
```

---

## Dependency Analysis

The table below lists every external dependency and how to replace it if you want to run Vemotion fully independently, without the Vegvisr ecosystem.

### 1. Authentication (most significant dependency)

| Dependency | What it does | How to replace |
|---|---|---|
| `cookie.vegvisr.org` | Sends and verifies passwordless magic link emails | Deploy your own magic link worker, or replace with Clerk, Auth0, Supabase Auth, or any token-based auth |
| `dashboard.vegvisr.org` | Returns user role, user_id, and auth token | Replace with your own user API — see **Standalone Auth** below |
| `vegvisr-ui-kit` npm package | `AuthBar` + `EcosystemNav` top-nav components | Replace with plain React components — see **Standalone Auth** below |

### 2. Composition Storage

| Dependency | What it does | How to replace |
|---|---|---|
| `api.vegvisr.org/vemotion/*` | Save, load, list, delete compositions | Deploy `vemotion-worker/index.js` to your own Cloudflare account |

The worker is open source and lives in the [vegvisr-frontend](https://github.com/torarnehave1/vegvisr-frontend) repository under `vemotion-worker/`. Its full OpenAPI spec is available at `https://api.vegvisr.org/vemotion/openapi.json`.

### 3. Image Assets (Photos API)

| Dependency | What it does | How to replace |
|---|---|---|
| `photos-api.vegvisr.org/list-r2-images` | Lists images in an album with metadata | Deploy the open source photos-worker, or replace with any endpoint returning `{ images: [{ key, url, name?, tags? }] }` |
| `photos-api.vegvisr.org/upload` | Uploads a new image to an album | Replace with any file upload endpoint, or remove the upload button |
| `vegvisr.imgix.net` | Serves the images via CDN | Replace with your own Cloudflare R2 public URL or any image CDN |

> Image URLs are stored directly in the composition JSON (`properties.src`). The renderer loads them at runtime via the browser's image cache.

### 4. Shapes and Cards (Knowledge Graph)

| Dependency | What it does | How to replace |
|---|---|---|
| `knowledge.vegvisr.org` | Provides shape SVG paths and card templates in the Add Layer picker | Option A: Deploy the open source knowledge-graph-worker to your own account. Option B: Replace with a static JSON file — see **Static Shapes and Cards** below |

> Shapes and cards are **snapshotted into the composition at add-time**. The running composition is self-contained and does not call the Knowledge Graph at runtime.

### 5. Assets and Fonts

| Dependency | How to replace |
|---|---|
| `favicons.vegvisr.org` | Replace with your own favicon files in `/public` and update `index.html` |
| `vegvisr.imgix.net` (login logo) | Replace with your own image in `/public` and update `src/components/Login.tsx` |
| `fonts.googleapis.com` | Self-host the font files in `/public/fonts` and replace the `<link>` tags in `index.html` with `@font-face` declarations |
| `unpkg.com/@ffmpeg/core` | Download `ffmpeg-core.js` and `ffmpeg-core.wasm` from npm, host on your own CDN or R2, update the `baseURL` in `src/lib/exporter.ts` |

### 5. Cloudflare Bindings

These are account-specific values in `wrangler.toml`. Replace them with your own:

| Binding | Purpose | How to provision |
|---|---|---|
| D1 `video_generator` | User auth lookups | `npx wrangler d1 create video_generator` |
| KV `VIDEO_CACHE` | Composition storage | `npx wrangler kv namespace create VIDEO_CACHE` |
| R2 `video-generator-exports` | Exported video files | `npx wrangler r2 bucket create video-generator-exports` |
| Workers AI `AI` | AI layer generation | Enable in Cloudflare dashboard under Workers AI |
| `account_id` | Your Cloudflare account | Find in your Cloudflare dashboard → right sidebar |

---

## Setup — Running on Your Own Cloudflare Account

### Prerequisites

- Node.js 18+
- A Cloudflare account (free tier is sufficient)
- Wrangler: `npm install -g wrangler && wrangler login`

### Step 1 — Clone and install

```bash
git clone https://github.com/torarnehave1/vemotion.git
cd vemotion
npm install
```

### Step 2 — Create Cloudflare resources

```bash
npx wrangler d1 create video_generator
npx wrangler kv namespace create VIDEO_CACHE
npx wrangler r2 bucket create video-generator-exports
```

Copy the IDs printed by each command into `wrangler.toml`. Also replace `account_id` with your own Cloudflare account ID.

### Step 3 — Run the database migration

```bash
npx wrangler d1 execute video_generator --file=worker/migrations/0001_init.sql --remote
```

### Step 4 — Deploy the worker

```bash
npx wrangler deploy
```

### Step 5 — Configure the frontend

Create `.env.local` in the project root:

```bash
VITE_WORKER_URL=https://your-worker.your-subdomain.workers.dev
```

### Step 6 — Run locally

```bash
npm run dev
```

Or deploy to Cloudflare Pages:

```bash
npm run build
npx wrangler pages deploy dist
```

---

## Standalone Auth (without Vegvisr)

### Option A — No auth (single-user or local use)

Edit `src/App.tsx`. Remove the auth check and hardcode a user object:

```tsx
// Replace the auth logic with:
const authUser = { userId: 'local', email: 'you@example.com', role: 'admin', displayName: 'You' };
// Skip the Login screen and render Dashboard directly
```

### Option B — Replace with your own auth provider

The auth flow calls three endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /login/magic/send` | Sends a magic link email |
| `GET /login/magic/verify?token=X` | Verifies the token from the email |
| `GET /userdata?email=X` | Returns `{ user_id, emailVerificationToken, role }` |

Replace these in `src/App.tsx` and `src/components/Login.tsx` with any auth provider. The returned token is stored in `localStorage` as `emailVerificationToken` and sent as the `X-API-Token` header to the composition storage API.

### Option C — Deploy the Vegvisr Auth Worker yourself

The authentication worker is open source and can be deployed from the [vegvisr-frontend](https://github.com/torarnehave1/vegvisr-frontend) repository.

---

## Static Shapes and Cards (without Knowledge Graph)

Create `/public/vemotion-shapes.json`:

```json
[
  {
    "id": "shape-star",
    "label": "Star",
    "color": "#ffffff",
    "info": "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
    "metadata": { "viewBox": "0 0 24 24" }
  }
]
```

Create `/public/vemotion-cards.json`:

```json
[
  {
    "id": "card-dark",
    "label": "Dark Card",
    "metadata": {
      "backgroundColor": "#1e293b",
      "titleColor": "#ffffff",
      "bodyColor": "#94a3b8",
      "titleFontSize": 32,
      "bodyFontSize": 22,
      "borderRadius": 12,
      "padding": 24,
      "defaultWidth": 470,
      "defaultHeight": 250
    }
  }
]
```

Then update `src/components/AddLayerModal.tsx` — change the two `fetch()` calls to point to these local files instead of `knowledge.vegvisr.org`.

---

## Composition JSON Format

A composition is self-contained plain JSON — no external references at runtime.

```json
{
  "duration": 10,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "fontFamily": "Inter",
  "layers": [
    {
      "id": "title",
      "type": "text",
      "position": { "x": 100, "y": 400 },
      "size": { "width": 1720, "height": 200 },
      "startTime": 0,
      "layerDuration": 10,
      "animation": {
        "property": "opacity",
        "keyframes": [
          { "time": 0, "value": 0 },
          { "time": 1, "value": 1 }
        ]
      },
      "properties": {
        "text": "Hello World",
        "fontSize": 80,
        "color": "#ffffff",
        "align": "center",
        "fontWeight": "700",
        "fontFamily": "Caveat"
      }
    }
  ]
}
```

### Layer types

| Type | Description |
|---|---|
| `text` | Rendered text with word-wrap, alignment, font, color, and drop shadow |
| `shape` | Rectangle or circle filled with a solid colour |
| `image` | Image from URL (Imgix, R2, or any CORS-accessible URL). Supports `fit: cover \| contain \| fill` |
| `kg-shape` | SVG path snapshotted from the shape picker |
| `card` | Rounded box with title, body text, and styled background |

### Animatable properties

Any numeric layer property can be animated with keyframes (easeInOut interpolation):

```json
"animation": {
  "property": "opacity",
  "keyframes": [
    { "time": 0, "value": 0 },
    { "time": 1, "value": 1 }
  ]
}
```

Common animated properties: `opacity`, `offsetX`, `offsetY`, `fontSize`.

---

## API Endpoints

All endpoints require `X-API-Token` header except `/health` and `/openapi.json`.
Full spec: `GET /vemotion/openapi.json`

| Method | Path | Description |
|---|---|---|
| GET | `/vemotion/health` | Health check |
| GET | `/vemotion/openapi.json` | Full OpenAPI 3.1 spec |
| GET | `/vemotion/compositions` | List all compositions for the authenticated user |
| GET | `/vemotion/composition?id=X` | Fetch a single composition |
| POST | `/vemotion/composition/save` | Save or update a composition |
| DELETE | `/vemotion/composition?id=X` | Delete a composition |
| POST | `/vemotion/render` | Queue a render job |
| GET | `/vemotion/render?id=X` | Poll render job status |
| GET | `/vemotion/renders` | List all render jobs |

---

## Project Structure

```
video-generator/
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx       — main layout (resizable sidebar)
│   │   ├── CompositionEditor.tsx — layer list, settings, export
│   │   ├── VideoPreview.tsx    — canvas playback
│   │   ├── TimelineEditor.tsx  — timeline scrubber
│   │   ├── AddLayerModal.tsx   — add/edit layers (manual, shapes, cards, AI)
│   │   ├── FileMenu.tsx        — cloud save/load
│   │   └── Login.tsx           — magic link login
│   └── lib/
│       ├── renderer.ts         — CanvasRenderer + PlaybackController
│       ├── exporter.ts         — ffmpeg.wasm MP4 export
│       ├── api.ts              — TypeScript types + fetch helpers
│       └── auth.ts             — localStorage auth helpers
├── worker/                     — Cloudflare Worker (local API)
├── index.html                  — Google Fonts, favicons
└── wrangler.toml               — Cloudflare bindings
```

---

## What Remains to Build

- Image, video, and audio layer types
- Spring animations and multiple animations per layer
- Layer groups
- Timeline drag-to-reorder layers
- Agent-Builder integration (AI video subagent)

---

## License

MIT — use it however you want.
