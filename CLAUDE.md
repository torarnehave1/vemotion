# Claude Code instructions for video-generator

## MANDATORY — read `_project/lessons_learned.md` BEFORE EVERY RESPONSE

Not per session. **Per response.** The full file, with the Read tool. Token cost is not a
consideration. If you are about to send any reply that involves code, commits, claims about
state, design decisions, or interpreting an instruction — open the file first. The Read call
is visible in the transcript; that's the proof it happened.

> `_project/` is local-only scaffold (gitignored). It is installed per-clone via the
> bootstrap script referenced in the global `~/.claude/CLAUDE.md`. If `_project/` is
> absent in this checkout, run the bootstrap before continuing. Companion docs (local):
> `_project/lessons_learned.md` (READ FIRST), `_project/STATUS.md`, `_project/TODO.md`,
> `_project/PLAN.md`, `_project/TEST_PLAN.md`.

---

## Before creating any new UI component
- Always search the existing codebase for similar components first.
- If a modal, form, panel, or UI pattern already exists, reuse or extend it — do not build a new one from scratch.
- Use grep or the Explore agent to find existing components before writing new code.

## Before implementing anything non-trivial
- Clarify the requirement first — ask a short question or present 2-3 options and wait for the user to choose.
- Do not assume intent and start building. A quick confirmation upfront prevents wasted work.

## Wrangler / Cloudflare CLI
- Wrangler is NOT installed globally. Always use `npx wrangler` from the project directory, or the project-local `./node_modules/.bin/wrangler`.
- Never prefix wrangler commands with `CLOUDFLARE_ACCOUNT_ID=...` — the account_id is already in `wrangler.toml`. Just run `npx wrangler <command>` from `/Volumes/T7/video-generator`.
- If wrangler returns a 401/400 auth error, the OAuth token has expired. Tell the user to run `wrangler login` interactively — do not attempt to work around it.
- D1 migrations live in `worker/migrations/`. Apply them with: `npx wrangler d1 execute video_generator --file=worker/migrations/<file>.sql --remote`
- After changing `worker/index.ts`, redeploy with: `npx wrangler deploy`

## Knowledge Graph API
- Full OpenAPI spec: `https://knowledge.vegvisr.org/openapi.json`
- Base URL: `https://knowledge.vegvisr.org` (production worker: `https://knowledge-graph-worker.torarnehave.workers.dev`)
- Auth: `X-API-Token` header — token in `/Users/torarnehave/Documents/GitHub/Knowledge-Editor/.env.example` as `VITE_KNOWLEDGE_API_TOKEN`
- mermaid diagrams use node type `mermaid-diagram` with raw Mermaid code (no fences) in the `info` field
- `patchNode` requires `expectedVersion` — node `.version` in `getknowgraph` response is always `null`; instead call `patchNode` with `expectedVersion: 0` first — if there's a version mismatch, the error response includes `"currentVersion": N`; use that N as `expectedVersion` and retry
- For complex JSON payloads (mermaid diagrams etc), write to a temp file and use `curl --data-binary @file` to avoid shell escaping issues

## KG Graph Creation/Updates — MANDATORY
- To create or update a KG graph, ALWAYS use `POST https://knowledge.vegvisr.org/saveGraphWithHistory` with body `{ "id": "<graphId>", "graphData": { "nodes": [...], "edges": [...] }, "override": true }`
- Do NOT use `saveknowgraph` (causes UNIQUE constraint errors), `updateknowgraph` (requires both id and graph data or errors), or `addNode` (adds to wrong graph context)
- `saveGraphWithHistory` is the single correct endpoint for all graph creation and updates

## Vemotion Animations Model — MANDATORY
- **One KG node = one animation.** Do not split an animation into multiple nodes, and do not bundle multiple animations into one node.
- The graph `vemotion-animations` holds these nodes. Each node has: `id`, `label` (display name), `color` (theme color), and `info` (the technical definition the renderer needs).
- The Animations tab in the Add Layer modal renders **one card per node** in `vemotion-animations`. It does NOT iterate over the contents of the `info` field.
- To add a new animation: add a new node to `vemotion-animations` with `type: "animation-library"` (or similar), a clear label, and the definition in `info`. The Animations tab picks it up automatically.

## Self-updating rule
- When a command fails due to a missing tool, wrong path, expired credential, or wrong assumption about the environment, add a note to this file immediately so the same mistake is not repeated.

## Build before pushing — MANDATORY
Always run `npm run build` from `/Volumes/T7/video-generator` before every `git push`.
Fix all TypeScript and build errors before pushing. Never push a broken build.

## Commit, push, and report — MANDATORY
After every completed code change, immediately:
1. `git add` the changed files
2. `git commit` with a descriptive message
3. `git push origin main`
4. Report back to the user with: what was pushed, the commit message, and the target (`github.com/torarnehave1/vemotion → main`)

Do NOT wait for the user to ask. Never silently push without reporting. Never complete a task without committing.

## General
- Keep components consistent with the existing dark slate design system.
- Prefer editing existing files over creating new ones.

## Project Context — Vemotion

**POC graph:** `video-generator-poc-2026` — view at https://www.vegvisr.org/gnew-viewer?graphId=video-generator-poc-2026

**Why this was built:**
Vemotion was initially built on Remotion. Remotion's dependency on Node.js, headless Chromium, and FFmpeg made it incompatible with a Cloudflare-native architecture. This POC explores a lightweight, fully open source alternative — running entirely on Cloudflare with the browser doing the rendering.

**The core question answered (confirmed 2026-05-11):**
Can we build a composable, AI-assisted video generation system that is lightweight, fully open source, exposes open APIs, runs on Cloudflare with the browser rendering, and produces high-quality MP4s? **Yes.** MP4 export via ffmpeg.wasm proven working in the browser.

**KG graphs used by Vemotion:**
- `vemotion-shapes` — SVG path shapes, snapshotted into compositions as `kg-shape` layers
- `vemotion-cards` — card templates (background, title, body styling), snapshotted as `card` layers
- `vemotion-architecture-2026` — architecture diagram of the full system

**Worker:** `https://api.vegvisr.org/vemotion/*` — deployed via `npx wrangler deploy` from `/Users/torarnehave/Documents/GitHub/vegvisr-frontend/vemotion-worker/`

**Worker deploy policy:** `npx wrangler deploy` from the worker dir is the *entire* publish path — that puts the code live on `api.vegvisr.org`. **Git commits in the worker repo are managed by the user separately and are NOT part of the deploy flow.** Do NOT auto-commit or auto-push the worker repo from this project. After editing + deploying + verifying the live endpoint, stop. The "Commit, push, and report — MANDATORY" rule below applies only to this repo (`github.com/torarnehave1/vemotion`); the worker is a different repo with a different lifecycle.

**Vemotion Worker OpenAPI spec:** `https://api.vegvisr.org/vemotion/openapi.json`

**Auth token** (`X-API-Token` header): `b1ca2967e8165ec02fdf039d9e916af4005f7388` (torarnehave@gmail.com `emailVerificationToken` from D1)

**Key endpoints (all require `X-API-Token` header except health/openapi):**
- `GET  /vemotion/health` — health check
- `GET  /vemotion/compositions` — list all compositions for the authed user
- `GET  /vemotion/composition?id=<id>` — fetch a single composition
- `POST /vemotion/composition/save` — save/update a composition `{ id?, name, composition }`
- `DELETE /vemotion/composition?id=<id>` — delete a composition
- `GET  /vemotion/projects` — list projects
- `POST /vemotion/project` — create/update a project
- `DELETE /vemotion/project?id=<id>` — delete a project
- `POST /vemotion/render` — queue a render job `{ compositionId? | composition, format? }`
- `GET  /vemotion/render?id=<id>` — poll render job status
- `GET  /vemotion/renders` — list all render jobs for the authed user

**Remaining gaps:**
- Image, video, audio layers
- Spring animations
- Multiple animations per layer
- Agent-Builder video subagent wiring
