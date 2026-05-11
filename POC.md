# Video Generator — Proof of Concept

## What this is

A proof of concept for browser-based video composition and rendering. It is a small app within the larger Vegvisr ECO system. It demonstrates that a complete video generation pipeline can run on Cloudflare infrastructure without any server-side rendering or FFmpeg processes.

## Problem statement

Traditional video generation tools (Remotion, FFmpeg-based pipelines) require dedicated render servers. This does not fit a Cloudflare Workers architecture. The question this POC answers is:

> Can we build a composable, AI-assisted video generation system that is lightweight, easy to use, and fully open source — with no proprietary dependencies — that exposes open APIs, runs entirely on Cloudflare with the browser doing the rendering, and can produce equally high-quality rendered videos as Remotion?

## Context within the Vegvisr ECO system

The Vegvisr ECO system is a large platform with many apps and services. The video generator is one small app within it. It connects to two of the platform's core services:

```
┌──────────────────────────────────────────────────────────────┐
│                    Vegvisr ECO System                        │
│                  (many apps and services)                    │
│                                                              │
│  Core services used by this POC:                             │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐    │
│  │  Knowledge Graph │    │        Agent-Builder          │    │
│  │  knowledge.      │    │        agent.vegvisr.org      │    │
│  │  vegvisr.org     │    │                               │    │
│  │                  │    │   POST /chat (SSE)             │    │
│  │  Stores nodes,   │    │   - Claude orchestration      │    │
│  │  graphs, video   │    │   - Workers AI path           │    │
│  │  metadata        │    │   - Video subagent            │    │
│  └────────┬─────────┘    └──────────────┬────────────────┘    │
│           │                             │                    │
│           └──────────────┬──────────────┘                    │
│                          │                                   │
│           ┌──────────────▼───────────────┐                   │
│           │   Video Generator (this POC)  │                   │
│           │   Small app, not a core       │                   │
│           │   platform service            │                   │
│           │                               │                   │
│           │   React/Vite frontend         │                   │
│           │   Canvas renderer             │                   │
│           │   Cloudflare Worker API       │                   │
│           │   Workers AI layer gen        │                   │
│           └───────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────┘
```

### Knowledge Graph API

**Endpoint:** `https://knowledge.vegvisr.org`

The Knowledge Graph is the content and data layer for the whole Vegvisr platform. In the context of video generation it provides:

- storage for JSON compositions as graph nodes
- `cloudflare-video` node type for storing rendered video metadata
- graph context passed to the agent at session start
- version history for compositions

A video composition saved to the Knowledge Graph becomes a first-class node that any agent or surface in the ecosystem can reference.

### Agent-Builder

**Endpoint:** `https://agent.vegvisr.org`

The Agent-Builder is the AI orchestration layer. It connects to the video generator through:

- a dedicated **video subagent** that handles video-specific workflows
- the `generate-layer` tool which calls Workers AI to create composition layers from natural language
- the ability to load a `graphId` that contains an existing composition and modify it
- `save_learning` to persist video generation patterns back into the system prompt graph

When a user asks the agent to "create a video intro", the agent delegates to the video subagent, which uses the Worker API and Knowledge Graph to build and store the composition.

### Video Generator (this POC)

**Frontend:** React + Vite + TypeScript + Tailwind CSS + vegvisr-ui-kit  
**Worker:** Cloudflare Worker (Hono) at `video-generator-worker`  
**Storage:** KV (compositions), R2 (exports), D1 (metadata)

## What was built

### Canvas rendering engine (`src/lib/renderer.ts`)

A frame-based rendering engine that runs entirely in the browser:

- `interpolate(keyframes, time)` — easeInOut keyframe interpolation
- `CanvasRenderer.renderFrame(composition, frameNumber)` — renders a single frame to an HTML5 Canvas
- `PlaybackController` — `requestAnimationFrame`-based playback loop with play/pause/seek

Supports two layer types:
- **text** — font size, color, alignment, font weight, drop shadow
- **shape** — rect and circle with fill color

Each layer can have one animation property (`opacity`, `offsetX`, `offsetY`) with arbitrary keyframes.

### Cloudflare Worker API (`worker/index.ts`)

Built with Hono. Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/video/create` | Queue a video render job |
| `GET` | `/api/video/:id/status` | Poll render status |
| `GET` | `/api/video/:id/download` | Get signed R2 download URL |
| `POST` | `/api/video/generate-layer` | Generate a layer from a natural language prompt via Workers AI |
| `GET` | `/api/templates` | List composition templates |

### AI layer generation

The `POST /api/video/generate-layer` endpoint uses Cloudflare Workers AI with `@cf/meta/llama-3.1-8b-instruct` to convert a natural language description into a layer JSON object.

Example prompt: _"A red rectangle that slides in from the left"_

The model returns a structured layer object including type, position, size, color, and animation keyframes. The response is validated and passed directly to the composition.

### Composition editor (`src/components/CompositionEditor.tsx`)

- duration, FPS, width, height controls
- layer list with inline text editing
- add/remove layers

### Add Layer modal (`src/components/AddLayerModal.tsx`)

Two modes:

**Manual tab:**
- layer type (text / shape)
- color picker
- position and size inputs
- animation preset selector (none, fade-in, fade-out, fade-in-out, slide from left/right/top/bottom)

**AI Prompt tab:**
- free-text description field
- calls `POST /api/video/generate-layer` on the Worker
- adds the returned layer directly to the composition

## What was proven

| Capability | Status |
|---|---|
| JSON composition → canvas rendering | Working |
| Keyframe animation with easeInOut | Working |
| Real-time playback via requestAnimationFrame | Working |
| Manual layer editor | Working |
| Animation presets | Working |
| Workers AI layer generation from natural language | Working |
| Cloudflare KV for composition storage | Configured |
| Cloudflare R2 for video export storage | Configured |
| Cloudflare D1 for metadata | Configured |
| vegvisr-ui-kit integration | Working |
| Vegvisr auth bypass for local dev | Working |

## What is not yet implemented

| Capability | Notes |
|---|---|
| MP4 export | Requires ffmpeg.wasm in the browser or a render worker |
| Knowledge Graph save/load | Integration point is defined but not wired |
| Agent-Builder video subagent calls | Endpoint exists, agent delegation not wired |
| Multiple animations per layer | Currently one animation property per layer |
| Image and video layers | Only text and shape layers today |
| Template library | Stub endpoints exist, D1 schema not yet defined |

## Cloudflare infrastructure

```toml
# Bindings
KV  VIDEO_CACHE   — composition and status storage
D1  DB            — video_generator database
R2  VIDEOS        — video-generator-exports bucket
AI                — Workers AI binding for layer generation

# Environment variables
MAX_DURATION = "300"
FRAME_RATE   = "30"
```

## Local development

```bash
# Frontend
cd /Volumes/T7/video-generator
npm install
npm run dev

# Worker (connects to real Cloudflare AI binding)
npm run dev:worker
```

Add `?dev=true` to the URL to bypass Vegvisr auth in local development.

## Next steps

### Short term
1. Implement MP4 export using ffmpeg.wasm
2. Wire the "Generate Video" button to the Worker render pipeline
3. Add multiple animation properties per layer

### Medium term
4. Save compositions to Knowledge Graph as `cloudflare-video` nodes
5. Load existing compositions from a graph node into the editor
6. Wire the Agent-Builder video subagent to call `POST /api/video/generate-layer`

### Long term
7. Deploy to `remotion.vegvisr.org` as a hosted editor surface
8. Add the video generator as a skill bound to the video subagent in Agent-Builder
9. Store rendered video metadata back into Vegvisr graphs so other agents can reference completed videos

## Remotion capability baseline

To honestly evaluate the problem statement, we need to know what Remotion actually does. The table below lists Remotion's capabilities and the current status of this POC against each one.

### What Remotion does

| Capability | Description |
|---|---|
| React-based compositions | Videos are written as React components. Any CSS, SVG, or HTML that renders in a browser works. |
| Frame-by-frame rendering | Headless Chromium renders each frame as a screenshot. FFmpeg then stitches frames into video. |
| `useCurrentFrame()` | Hook returns the current frame number so components can animate based on time. |
| `interpolate()` | Maps a value across an input range to an output range with configurable easing and extrapolation. |
| `spring()` | Physics-based animation with stiffness, damping, and mass parameters. |
| `Sequence` | Time-shifts children by a frame offset — controls when layers appear and for how long. |
| `Series` | Stitches multiple `Sequence` blocks together sequentially with automatic timing. |
| `AbsoluteFill` | Full-canvas absolutely positioned div for layering elements. |
| `useVideoConfig()` | Hook returning width, height, fps, durationInFrames for the current composition. |
| `Still` | Single-frame variant for rendering static images using the same API. |
| Audio support | `<Audio>` component with volume, playback rate, trimming, and waveform data. |
| Video layers | `<Video>` component embeds video files with frame-accurate playback. |
| Image sequences | Convert image sequences to video. |
| Lottie animations | Render Lottie JSON animations frame-accurately. |
| Custom fonts | Full web font support via standard CSS. |
| 3D / WebGL | Three.js and WebGL render inside compositions because Chromium supports them. |
| Transitions | Built-in and composable scene transition effects. |
| Multiple output formats | MP4, WebM, GIF, image sequences, audio-only, transparent video (ProRes). |
| Any resolution and fps | 4K, portrait, square, 60fps — all configurable per composition. |
| Remotion Studio | Local dev server with frame scrubber, sidebar, live preview, visual prop editor. |
| Remotion Player | React component for embedding playback in web apps with prop reactivity. |
| Remotion Lambda | AWS Lambda distributed rendering — parallel workers, S3 output, elastic scale. |
| CLI | `npx remotion render` for scripted or CI-driven rendering. |
| TypeScript + Zod schemas | Type-safe compositions with visual schema-driven prop editing in Studio. |
| Licensing | Open source core (MIT). Remotion Lambda, Timeline, and Recorder are commercial products. |

### How this POC compares today

| Capability | Remotion | This POC | Notes |
|---|---|---|---|
| Composable layers | React components | JSON layer objects | Different model — JSON is simpler but less expressive |
| Text layers | Full CSS/SVG/HTML | Canvas 2D text | Canvas text lacks CSS layout power |
| Shape layers | Full CSS/SVG | Canvas rect/circle | Basic shapes only |
| Image layers | Yes | Not yet | Planned |
| Video layers | Yes | Not yet | Planned |
| Audio layers | Yes | Not yet | Planned |
| Keyframe animation | `interpolate()` with easing | `interpolate()` with easeInOut | Similar model, fewer easing options |
| Spring animation | `spring()` | Not yet | Planned |
| Multiple animations per layer | Yes (per property) | One property per layer | Known limitation |
| Sequencing | `Sequence` / `Series` | Not yet | Planned |
| Playback preview | Remotion Studio | Canvas + requestAnimationFrame | Works, no scrubber timeline UI yet |
| MP4 export | FFmpeg (server-side) | Not yet (ffmpeg.wasm planned) | Key gap |
| GIF export | Yes | Not yet | — |
| Resolution control | Any | 720p / 1080p / 1920 presets | Configurable |
| fps control | Any | 24 / 30 / 60 | Sufficient |
| AI layer generation | No | Yes (Workers AI) | Advantage over Remotion |
| Open source | Core yes, tools commercial | Fully open source | Advantage |
| Runs on Cloudflare | No (requires Node.js) | Yes | Core differentiator |
| No proprietary runtime | No (Lambda is commercial) | Yes | Core differentiator |
| Open API | No built-in | Yes (Worker endpoints) | Advantage |
| Browser rendering | No (headless Chromium) | Yes (HTML5 Canvas) | Key architectural difference |

### Honest assessment

Remotion produces higher-quality output today because it uses a full browser engine (CSS, SVG, WebGL) and FFmpeg encoding. This POC uses Canvas 2D which is more limited for complex layouts and typography.

The path to closing the gap:
1. **ffmpeg.wasm** for in-browser MP4 encoding closes the export gap
2. **More layer types** (image, video, audio) close the media gap
3. **SVG/HTML layers** rendered to canvas can close the visual quality gap
4. **Spring animations** and more easing functions close the animation gap

The core differentiators this POC has over Remotion — runs on Cloudflare, no proprietary runtime, open API, AI-assisted layer generation — are architectural advantages that Remotion cannot replicate without a full redesign.

---

## Remotion terminology glossary

| Term | Definition |
|---|---|
| **Composition** | A registered video component defining the canvas: width, height, fps, and durationInFrames. Listed in the Studio sidebar. |
| **useCurrentFrame()** | Hook returning the current zero-indexed frame number relative to the enclosing Sequence or top-level composition. |
| **useVideoConfig()** | Hook returning composition metadata: width, height, fps, durationInFrames, id, defaultProps. |
| **interpolate()** | Maps an input value across one range to an output range with optional easing and extrapolation (clamp, extend, wrap). |
| **spring()** | Physics-based animation function. Accepts frame, fps, and config (stiffness, damping, mass). Returns a 0→1 value. |
| **durationInFrames** | Length of a composition or sequence expressed as a frame count. Divide by fps to get seconds. |
| **fps** | Frames per second. Controls playback speed and temporal resolution of the composition. |
| **Sequence** | Container component that time-shifts children by a `from` frame offset. Nested sequences accumulate offsets. |
| **Series** | Stitches `<Series.Sequence>` blocks together sequentially with automatic timing. Built on top of Sequence. |
| **AbsoluteFill** | Helper component rendering as an absolutely positioned div that fills the full canvas. Used for layering. |
| **Still** | A single-frame composition variant. Same API as Composition but no durationInFrames or fps. |
| **Easing** | Timing function controlling acceleration (linear, ease-in, ease-out, cubic-bezier, etc.). |
| **Keyframe** | A frame at which a property value is explicitly defined. Interpolation fills values between keyframes. |
| **Bundle** | A Webpack-compiled package of the Remotion project. Required before rendering. Cannot run on serverless. |
| **Render** | The process of converting a composition to output video. Can be triggered via Studio, CLI, or API. |
| **Codec** | Video compression format (h264, h265, vp8, vp9, prores). Determines output quality and compatibility. |
| **CRF** | Constant Rate Factor. Lower = higher quality, larger file. Controls lossy encoding quality. |
| **Remotion Studio** | Local development server. Provides frame scrubber, sidebar, live preview, and visual prop editing. |
| **Remotion Player** | React component for embedding Remotion video in web apps with prop reactivity and custom controls. |
| **Remotion Lambda** | AWS Lambda distributed rendering service. Parallel workers, S3 output, elastic scale. Commercial product. |
| **Remotion Recorder** | Tool for recording facecam/screen with auto-captions via Whisper.cpp and social format export. Commercial. |
| **Timeline** | Commercial drag-and-drop multi-track editor component for Remotion Player. |
| **Input Props** | JSON-serializable parameters passed into a composition for dynamic customisation. |
| **defaultProps** | Initial prop values defined on a Composition. Overridden at render time via Player or CLI. |
| **calculateMetadata()** | Optional async Composition prop for computing derived metadata from input props before rendering. |
| **schema prop** | Zod validation schema on a Composition that enables visual prop editing in Remotion Studio. |
| **staticFile()** | Utility that resolves paths to files in the public directory at runtime. |
| **lazyComponent** | Dynamic React import for a composition component, reducing startup time via Suspense. |
| **Entry Point** | The project's root TypeScript file (typically `src/index.ts`) that registers all Compositions and Stills. |
| **Public Dir** | Directory for static assets (images, fonts) accessible to compositions at runtime. |
| **Serve URL** | Web address serving the bundled Remotion project for Studio preview or Lambda rendering. |
| **Concurrency** | Number of parallel Lambda workers during distributed rendering. |

---

## References

### Official Remotion documentation
- [Remotion Docs](https://www.remotion.dev/docs) — Main documentation (800+ pages)
- [API Reference](https://www.remotion.dev/docs/api) — Full API reference
- [Remotion Player](https://www.remotion.dev/player) — Player component documentation
- [Remotion Lambda](https://www.remotion.dev/lambda) — Lambda rendering documentation
- [Timeline component](https://www.remotion.dev/docs/timeline) — Commercial timeline editor
- [Recorder](https://www.remotion.dev/docs/recorder) — Recorder tool documentation
- [Templates](https://www.remotion.dev/templates) — 35+ starter templates
- [Showcase](https://www.remotion.dev/showcase) — Projects built with Remotion
- [Blog](https://www.remotion.dev/blog) — Official blog
- [Licensing](https://remotion.pro/license) — License and pricing details

### Remotion source and packages
- [GitHub — remotion-dev/remotion](https://github.com/remotion-dev/remotion) — Open source repository (45k+ stars)
- [npm — remotion](https://www.npmjs.com/package/remotion) — npm package (1.4M+ monthly installs)

### Community
- [Discord](https://remotion.dev/discord) — Community (8,000+ members)
- [YouTube](https://youtube.com/@remotion_dev) — Video tutorials
- [X / Twitter](https://x.com/remotion) — Announcements

### Tools
- [Video Converter](https://remotion.dev/convert) — Browser-based format converter
- [Timing Editor](https://remotion.dev/timing-editor) — Visual timing tool
- [AI Prompt Showcase](https://remotion.dev/prompts) — AI-generated composition examples

---

## Conclusion

The POC demonstrates that a composable, AI-assisted video generation system is viable on Cloudflare infrastructure. The browser handles rendering via HTML5 Canvas, Workers AI handles natural language layer generation, and integration with the Vegvisr Knowledge Graph and Agent-Builder provides a clear path to a production-grade feature within the broader Vegvisr ECO system.

The system is not yet at Remotion's output quality, but the architectural advantages — fully open source, no proprietary runtime, runs on Cloudflare Workers, exposes open APIs — are real and achievable without the rendering gaps being fundamental blockers. The main gap to close is MP4 export via ffmpeg.wasm.
