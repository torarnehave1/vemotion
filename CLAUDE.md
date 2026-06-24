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

## STANDARD CHANGE WORKFLOW — follow every step, in order, for every change

This is the fixed sequence for any code change. No step is skippable. No step is offered as
optional (see lessons_learned Lesson 33).

1. **Read** `_project/lessons_learned.md` — the full file, with the Read tool.
2. **Find what is wrong** — investigate the actual cause with tool calls, not speculation.
3. **Fix** — make the change.
4. **State what changed** — name the file(s) and the change.
5. **Run build** — `npm run build` from `/Volumes/T7/video-generator`. Fix all errors. Never proceed on a broken build.
6. **Deploy with wrangler IF it is a worker** — `npx wrangler deploy` from the worker dir. (Worker repo is NOT git-committed by Claude; see Worker deploy policy.)
7. **Commit + push to git IF it is source code in this repo** — `git add` → `git commit` → `git push origin main`.
8. **Read `_project/lessons_learned.md` again and update it if this change surfaced a new lesson** — plus STATUS.md / TODO.md / TEST_PLAN.md per P1.

### Delivery report format (end of every change message)

End the message with the report. The push line MUST be the last line, on its own, so it is never
mistaken for prose:

```
Delivered: <what>. Tested: <build/other>. Caveats: <z>.
Pushed: <commit-hash> — github.com/torarnehave1/vemotion → main
```

If nothing was pushed (e.g. worker-only deploy, or _project-only/gitignored edits), the last line
states that explicitly: `Pushed: nothing — <reason>`.

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

## Build marker — bump on EVERY push — MANDATORY
The green badge in `src/components/Dashboard.tsx` (`VA`, `VB`, `VC`…) is the user's
visual proof the latest deploy is live. **Bump it on every push without exception** —
no "the change was too small." Sequence: VA → VB → VC → … → VZ → WA → WB …
Do this as part of the commit step, before `git push`. Never push without bumping.

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
- `POST /vemotion/video/upload` — upload a video file to the `vemotion-video` R2 bucket (binary body, `X-File-Name` header). Returns `{ url, key }`. Authed.
- `GET  /vemotion/video?key=<key>` — **public** (no auth — a `<video>` element can't send headers). Streams the file from `vemotion-video` R2 with HTTP Range support (206) so the player can seek. Video-layer sources upload here, NOT the audio/transcription R2.
- `POST /vemotion/suggest-meta` — body `{ composition }`. Runs **gemma** (`@cf/google/gemma-4-26b-a4b-it`) via the worker's Workers AI binding (`[ai] binding = "AI"`) to suggest `{ description, category, tags[], metaArea }` from a composition summary. Authed. Gemma is a reasoning model — read `resp.choices[0].message.content`, give it `max_tokens >= 4096`.

**Remaining gaps:**
- Video layer: visual playback + MP4 export shipped (canvas-drawn, z-order respected). NOT yet: muxing the video's own audio into the export (use a separate audio layer), trimming a sub-range of the source clip, looping.
- Spring animations
- Multiple animations per layer

**Agent-Builder integration (DONE — not a gap):** Agent-Builder (`builder.vegvisr.org`,
repo `/Users/torarnehave/Documents/GitHub/Agent-Builder`) is fully wired to Vemotion via a
service-bound worker (`VEMOTION_WORKER` → `vemotion-worker`). Its tool suite
(`worker/tool-definitions.js` / `tool-executors.js`) lets the agent create and
non-destructively edit compositions: `vemotion_save_composition` (full CompositionData or
`albumName` slideshow shortcut, create/update by `compositionId`), `vemotion_get_composition`
(read-before-edit), `vemotion_refit_composition` (server-side aspect-ratio refit), and
`get_vemotion_reference` (the composition cookbook). The agent can author working videos end
to end; the user renders to MP4 from the editor.
