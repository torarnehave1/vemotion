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
- mermaid diagrams use node type `mermaid-diagram` with raw Mermaid code (no fences) in the `info` field
- `patchNode` requires `expectedVersion` — fetch current version first with `getknowgraph`
- For complex JSON payloads (mermaid diagrams etc), write to a temp file and use `curl --data-binary @file` to avoid shell escaping issues

## Self-updating rule
- When a command fails due to a missing tool, wrong path, expired credential, or wrong assumption about the environment, add a note to this file immediately so the same mistake is not repeated.

## General
- Keep components consistent with the existing dark slate design system.
- Prefer editing existing files over creating new ones.
