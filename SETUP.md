# Setup Guide

## 1. Configure Cloudflare Account

### Get Your Account ID
```bash
wrangler whoami
```
This shows your account ID. Copy it.

### Configure wrangler.toml Locally

1. Copy `wrangler.example.toml` to `wrangler.toml` (already done, but for reference)
2. Edit `wrangler.toml` and replace:
   - `COPY_YOUR_ACCOUNT_ID_HERE` → Your account ID from `wrangler whoami`
   - `COPY_YOUR_KV_ID_HERE` → Your KV namespace ID
   - `COPY_YOUR_KV_PREVIEW_ID_HERE` → Your KV preview ID
   - `COPY_YOUR_D1_ID_HERE` → Your D1 database ID

### Create Resources on Cloudflare

#### KV Namespace (for video cache)
```bash
wrangler kv:namespace create "VIDEO_CACHE"
wrangler kv:namespace create "VIDEO_CACHE" --preview
```

Copy the IDs into `wrangler.toml`

#### D1 Database
```bash
wrangler d1 create video_generator
```

Copy the database ID into `wrangler.toml`

#### R2 Bucket
Go to Cloudflare Dashboard → R2 → Create bucket named `video-files`

## 2. Install Dependencies
```bash
npm install
```

## 3. Development

### Run Frontend Only
```bash
npm run dev
```
Opens `http://localhost:3002`

### Run Worker Only
```bash
npm run dev:worker
```
Worker runs on `http://localhost:8790`

### Run Both (Recommended)
```bash
npm run dev:all
```

The frontend automatically proxies `/api/*` requests to the worker.

## 4. Deployment

### Deploy Worker
```bash
wrangler deploy
```

This reads your local `wrangler.toml` and deploys to Cloudflare.

### Deploy Frontend to Cloudflare Pages

1. Build the frontend:
```bash
npm run build
```

2. Upload `dist/` to Cloudflare Pages

Or use Git integration:
```bash
git push origin main
```
(Cloudflare Pages auto-deploys from your repo)

## Important: wrangler.toml Security

**DO NOT commit `wrangler.toml` to git!**

- ✅ `wrangler.toml` is in `.gitignore` (local only)
- ✅ `wrangler.example.toml` is committed (shows the template)
- ✅ Sensitive IDs/keys stay on your machine
- ✅ Use `wrangler deploy` to push config to Cloudflare

### If You Accidentally Committed It
```bash
git rm --cached wrangler.toml
git commit -m "Remove wrangler.toml"
git push origin main

# Rotate your secrets on Cloudflare dashboard
```

## Environment Variables

For sensitive values, use Wrangler secrets instead:

```bash
wrangler secret put API_KEY
wrangler secret put JWT_SECRET
```

Then in `worker/index.ts`:
```typescript
const env = c.env as Env;
const apiKey = env.API_KEY; // From secrets
```

## Troubleshooting

**"Worker not found"**
- Check `account_id` in `wrangler.toml`

**"KV namespace not found"**
- Verify KV namespace IDs in `wrangler.toml`

**"API calls fail with 403"**
- Check your Cloudflare API token has permission to deploy workers
