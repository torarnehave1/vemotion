# Claude Code instructions for video-generator

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

## Self-updating rule
- When a command fails due to a missing tool, wrong path, expired credential, or wrong assumption about the environment, add a note to this file immediately so the same mistake is not repeated.

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
