# spud-updates-server

Small Next.js app Spud pings to check for updates (Electron feed) and, optionally, to show a manual reinstall notice. Forked from [voideditor/void-updates-server](https://github.com/voideditor/void-updates-server).

Deploy target example: `https://updates.spud.dev` (set `updateUrl` in `ide/product.json` when you ship auto-updates).

Entry point: [`app/[...route]/route.ts`](./app/[...route]/route.ts)

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

1. Build and sign desktop artifacts; upload `Spud-RawApp-*.zip`, `hash` metadata, and DMG to [spud-dev-ai/spud-ide releases](https://github.com/spud-dev-ai/spud-ide/releases).
2. Set `SPUD_LATEST_COMMIT`, `SPUD_RELEASE_TAG`, and hash env vars on the host running this server (e.g. Vercel).
3. Align `ide/product.json` `commit` / version with that release for clients that auto-update.

## Develop

```bash
cd spud-updates-server
npm install
npm run dev
```

## License

Apache-2.0 (retained from upstream void-updates-server).
