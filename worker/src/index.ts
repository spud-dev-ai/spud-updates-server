import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { validateInput } from './validateInput'

/**
 * Spud updates server — Cloudflare Worker.
 *
 * Electron (VS Code autoUpdater) endpoint: GET /api/update/<platform>/<quality>/<commit>
 *   - 204 No Content → client already on the latest commit, or integrity metadata missing
 *   - 200 JSON       → update available; body matches abstractUpdateService.createUpdateURL
 *
 * Legacy Void-era ping: GET /api/v0/<commit>  → { hasUpdate, downloadMessage? }
 * Health:               GET /api/health       → { ok, service, timestamp }
 *
 * Env vars come from wrangler.toml [vars] + `wrangler secret put`. See .env.example
 * at the repo root for the full list.
 */

type Env = {
	SPUD_LATEST_COMMIT?: string
	SPUD_RELEASE_TAG?: string
	SPUD_GITHUB_REPO?: string
	SPUD_DOWNLOAD_PAGE?: string
	SPUD_UPDATE_ZIP_URL?: string
	SPUD_UPDATE_SHA256?: string
	SPUD_UPDATE_SHA1?: string
	SPUD_UPDATE_TIMESTAMP?: string
	SPUD_PRODUCT_VERSION?: string
}

// strict: false — trailing slashes are equivalent, so /api/v0 and /api/v0/ both hit
// the same handler without needing duplicate registrations.
const app = new Hono<{ Bindings: Env }>({ strict: false })

// CORS + light caching for all API routes (replaces the old Next proxy.ts).
app.use(
	'/api/*',
	cors({
		origin: '*',
		allowMethods: ['GET', 'HEAD', 'OPTIONS'],
		maxAge: 86400,
	}),
)

app.use('/api/*', async (c, next) => {
	await next()
	// Edge cache update JSON briefly; Electron retries are seconds apart.
	if (c.req.method === 'GET' && c.res.status === 200) {
		c.res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
	}
})

// ───────────────────────────────────────────── /  (human landing page)
app.get('/', (c) =>
	c.text(
		[
			'spud-updates-server',
			'',
			'Endpoints:',
			'  GET /api/health                                  uptime + version',
			'  GET /api/update/:platform/:quality/:commit       Electron autoUpdater feed',
			'  GET /api/v0/:commit                              legacy ping',
			'',
			'Source: https://github.com/spud-dev-ai/spud-updates-server',
			'',
		].join('\n'),
		200,
	),
)

// ───────────────────────────────────────────── /api/health
app.get('/api/health', (c) =>
	c.json({
		ok: true,
		service: 'spud-updates-server',
		timestamp: new Date().toISOString(),
	}),
)

// ───────────────────────────────────────────── /api/update  (no path params)
// No platform/quality/commit supplied — return 204 "up to date" so any
// misconfigured client fails safe rather than hitting a confusing 404.
app.get('/api/update', () => new Response(null, { status: 204 }))

// ───────────────────────────────────────────── /api/update/:platform/:quality/:commit
app.get('/api/update/:platform/:quality/:commit', (c) => {
	const { platform, quality, commit: clientCommit } = c.req.param()
	const env = c.env

	const input = validateInput(platform, quality)
	if (!input) return new Response(null, { status: 204 })

	const latestCommit = env.SPUD_LATEST_COMMIT ?? ''
	if (!latestCommit || clientCommit === latestCommit) {
		return new Response(null, { status: 204 })
	}

	const sha256 = env.SPUD_UPDATE_SHA256
	const sha1 = env.SPUD_UPDATE_SHA1
	if (!sha256 || !sha1) {
		// Hashes not published yet — avoid a broken auto-update.
		return new Response(null, { status: 204 })
	}

	const tag = env.SPUD_RELEASE_TAG ?? 'v0.1.0'
	const repo = env.SPUD_GITHUB_REPO ?? 'spud-dev-ai/spud-ide'
	const zipUrl =
		env.SPUD_UPDATE_ZIP_URL ??
		`https://github.com/${repo}/releases/download/${tag}/Spud-RawApp-${platform}.zip`
	const timestamp = Number(env.SPUD_UPDATE_TIMESTAMP ?? String(Math.floor(Date.now() / 1000)))
	const productVersion = env.SPUD_PRODUCT_VERSION ?? '0.1.0'

	return c.json({
		url: zipUrl,
		version: latestCommit,
		productVersion,
		sha256hash: sha256,
		hash: sha1,
		timestamp,
	})
})

// ───────────────────────────────────────────── /api/v0  (no commit supplied)
// Mirrors the /api/v0/:commit shape so older clients and humans hitting the bare
// URL get a valid JSON body instead of a 404 page.
app.get('/api/v0', (c) => c.json({ hasUpdate: false }))

// ───────────────────────────────────────────── /api/v0/:commit (legacy Void ping)
app.get('/api/v0/:commit', (c) => {
	const { commit: clientCommit } = c.req.param()
	const env = c.env
	const latestCommit = env.SPUD_LATEST_COMMIT ?? ''

	if (!latestCommit || clientCommit === latestCommit) {
		return c.json({ hasUpdate: false })
	}

	const tag = env.SPUD_RELEASE_TAG ?? 'v0.1.0'
	const downloadPage = env.SPUD_DOWNLOAD_PAGE ?? 'https://spud.dev/download'
	return c.json({
		hasUpdate: true,
		downloadMessage: `A new Spud build is available (${tag}). [Download Spud](${downloadPage}). Please reinstall — auto-updates may be disabled on some platforms.`,
	})
})

app.notFound((c) => c.text('Not Found', 404))
app.onError((err, c) => {
	console.error('ERROR:', err)
	return new Response(null, { status: 500 })
})

export default app
