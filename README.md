# spud-updates-server

Small service Spud pings to check for updates (Electron feed) and, optionally, to show a manual reinstall notice. Originally forked from [voideditor/void-updates-server](https://github.com/voideditor/void-updates-server).

Deploy target: **Cloudflare Worker** at `https://updates.spud.dev` (set `updateUrl` in `ide/product.json` to this host).

Entry point (live): [`worker/src/index.ts`](./worker/src/index.ts) — Hono app on Cloudflare Workers.

> The original Next.js app under [`app/`](./app/) + [`vercel.json`](./vercel.json) is kept as a reference implementation. It is **not** the deployed server.

## Cloud deployment (Cloudflare Workers)

From [`worker/`](./worker/):

```bash
cd worker
npm install
npx wrangler deploy
```

`worker/wrangler.toml` pins:

- `name = "spud-updates-server"`
- Route `updates.spud.dev` as a **custom domain** (auto-creates the DNS record in the `spud.dev` zone on first deploy)
- `[vars]` with non-secret defaults (`SPUD_GITHUB_REPO`, `SPUD_DOWNLOAD_PAGE`, `SPUD_RELEASE_TAG`, `SPUD_PRODUCT_VERSION`)

### Per-release secrets — automated

Use the bundled script instead of running `wrangler secret put` by hand. It reads a GitHub release, downloads every `Spud-RawApp-<platform>.zip`, computes `SHA256`/`SHA1`, and pushes them (plus the commit SHA + tag + timestamp) to the Worker in one shot:

```bash
# one-shot from your laptop (uses `gh auth` / `wrangler login`)
./scripts/publish-release.sh v0.1.1

# dry run first
./scripts/publish-release.sh v0.1.1 --dry-run

# override the source repo
GITHUB_REPO=spud-dev-ai/spud-ide ./scripts/publish-release.sh v0.1.1
```

Per-platform hashes are written as `SPUD_UPDATE_SHA256_DARWIN_ARM64`, `SPUD_UPDATE_SHA1_DARWIN_X64`, etc., so each `/api/update/<platform>/...` endpoint returns the correct zip. The legacy `SPUD_UPDATE_SHA256` / `SPUD_UPDATE_SHA1` are also set (back-compat fallback).

In CI this is wired as [`.github/workflows/publish-release.yml`](./.github/workflows/publish-release.yml) — run it manually from the Actions tab with a `tag` input, or have the `spud-ide` release pipeline dispatch `repository_dispatch` with `event_type: ide-release` and `client_payload: { tag }`. Repo secrets needed: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and optionally `RELEASE_READ_GITHUB_TOKEN` for a private source repo.

#### Manual fallback (if you cannot use the script)

```bash
cd worker
npx wrangler secret put SPUD_LATEST_COMMIT     # full git SHA of the shipped build
npx wrangler secret put SPUD_UPDATE_SHA256
npx wrangler secret put SPUD_UPDATE_SHA1
# optional overrides:
npx wrangler secret put SPUD_UPDATE_ZIP_URL
npx wrangler secret put SPUD_UPDATE_TIMESTAMP
```

**Smoke test** once deployed:

```bash
curl -s https://updates.spud.dev/api/health
# → {"ok":true,"service":"spud-updates-server","timestamp":"..."}
curl -i https://updates.spud.dev/api/update/darwin-arm64/stable/abc123
# → HTTP/2 204 while SPUD_LATEST_COMMIT is unset (correct safe default)
```

Local development: `cd worker && npx wrangler dev` (runs the Worker on `localhost:8787` against the `miniflare` emulator). Copy values from [`.env.example`](./.env.example) into `worker/.dev.vars` to test with non-default env.

## Endpoints

### 1. VS Code–style feed (Electron `autoUpdater`)

`GET /api/update/<platform>/<quality>/<commit>`

- Example: `/api/update/darwin-arm64/stable/abc123...`
- **204 No content** — client is on the latest commit, or server is not configured for zip/hashes yet.
- **200 JSON** — update available; body matches what `abstractUpdateService` expects (`url`, `sha256hash`, `hash`, `timestamp`, `version`, `productVersion`).

`platform` / `quality` are validated with the same rules as upstream (see `validateInput.ts`).

### 2. Legacy `/api/v0/<commit>`

Used by some Void-era forks for a simple `{ hasUpdate, downloadMessage }` JSON response. Spud keeps it for compatibility.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `SPUD_LATEST_COMMIT` | Full SHA the app is considered “up to date” on (must match `commit` baked into `ide/product.json` at build time). |
| `SPUD_RELEASE_TAG` | GitHub release tag (e.g. `v0.1.0`) for default zip URL and copy. |
| `SPUD_GITHUB_REPO` | Default `spud-dev-ai/spud-ide`. |
| `SPUD_DOWNLOAD_PAGE` | Default `https://spud.dev/download` (manual reinstall CTA). |
| `SPUD_UPDATE_ZIP_URL` | Optional full URL to `Spud-RawApp-<platform>.zip`. If unset, derived from repo + tag. |
| `SPUD_UPDATE_SHA256` / `SPUD_UPDATE_SHA1` | Required (with `SPUD_LATEST_COMMIT`) to return a **200** JSON body on `/api/update/...`; otherwise the handler returns **204** so Electron does not download a build without integrity metadata. |
| `SPUD_UPDATE_SHA256_<PLATFORM>` / `SPUD_UPDATE_SHA1_<PLATFORM>` / `SPUD_UPDATE_ZIP_URL_<PLATFORM>` | Optional per-platform overrides (`<PLATFORM>` = `DARWIN_ARM64`, `DARWIN_X64`, `WIN32_X64`, `LINUX_X64`, …). If unset, the handler falls back to the plain `SPUD_UPDATE_*` secrets. Written automatically by `scripts/publish-release.sh`. |
| `SPUD_UPDATE_TIMESTAMP` | Optional Unix seconds for JSON payload. |
| `SPUD_PRODUCT_VERSION` | Optional `productVersion` field (defaults to `0.1.0`). |

## IDE configuration

In `spud/ide/product.json`, when you are ready for the built-in updater:

- Set `updateUrl` to your deployed origin (no trailing slash), e.g. `https://updates.spud.dev`.
- Set `commit` to the same value as `SPUD_LATEST_COMMIT` for that shipped build.
- Set `quality` (e.g. `stable`) if not already present in your product merge.

`createUpdateURL` in the fork resolves to:

`${updateUrl}/api/update/${platform}/${quality}/${commit}`.

## Releases and signing

Maintainer scripts (adapted from Void) live under [`spud-release-scripts/`](./spud-release-scripts/). They expect a signed `Spud.app` under `VSCode-darwin-<arch>/` after your `ide` gulp build (`nameLong` → **Spud**).

Set `SPUD_IDE_DIR` to your local `spud/ide` checkout (see `mac-sign.sh`).

## New release checklist

1. Build and sign desktop artifacts; upload `Spud-RawApp-*.zip` and the DMG to [spud-dev-ai/spud-ide releases](https://github.com/spud-dev-ai/spud-ide/releases).
2. Run `./scripts/publish-release.sh v0.x.y` (or trigger the `publish-release` GitHub Action with that tag). It sets `SPUD_LATEST_COMMIT`, `SPUD_RELEASE_TAG`, `SPUD_UPDATE_TIMESTAMP`, and per-platform `SPUD_UPDATE_SHA256_*` / `SPUD_UPDATE_SHA1_*` / `SPUD_UPDATE_ZIP_URL_*` from the release’s zip assets.
3. Align `ide/product.json` `commit` / version with that release for clients that auto-update. (Usually already done by the builder pipeline.)

## Develop

```bash
# live Worker
cd spud-updates-server/worker
npm install
npx wrangler dev           # http://localhost:8787

# Next.js reference (not deployed)
cd spud-updates-server
npm install
npm run dev                # http://localhost:3000
```

## License

Apache-2.0 (retained from upstream void-updates-server).
