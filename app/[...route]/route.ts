

// Update checks must run per request (commit in URL, env on the host).
export const dynamic = 'force-dynamic'

export const dynamicParams = true // false -> any new [version] will be treated as a 404
export const runtime = 'nodejs'
export const preferredRegion = 'auto'

import { validateInput } from './validateInput'

const latestVersionTagForMessage = process.env.SPUD_RELEASE_TAG ?? 'v0.1.0'
const downloadPage = process.env.SPUD_DOWNLOAD_PAGE ?? 'https://spud.dev/download'
const latestCommit = process.env.SPUD_LATEST_COMMIT ?? ''
const githubRepo = process.env.SPUD_GITHUB_REPO ?? 'spud-dev-ai/spud-ide'

function updateJsonForPlatform(platform: string) {
	const sha256 = process.env.SPUD_UPDATE_SHA256
	const sha1 = process.env.SPUD_UPDATE_SHA1
	if (!sha256 || !sha1 || !latestCommit) {
		return null
	}
	const tag = process.env.SPUD_RELEASE_TAG ?? 'v0.1.0'
	const zipUrl =
		process.env.SPUD_UPDATE_ZIP_URL ??
		`https://github.com/${githubRepo}/releases/download/${tag}/Spud-RawApp-${platform}.zip`
	const timestamp = Number(process.env.SPUD_UPDATE_TIMESTAMP ?? String(Math.floor(Date.now() / 1000)))
	const productVersion = process.env.SPUD_PRODUCT_VERSION ?? '0.1.0'
	return {
		url: zipUrl,
		version: latestCommit,
		productVersion,
		sha256hash: sha256,
		hash: sha1,
		timestamp,
	}
}

// https://nextjs.org/docs/app/building-your-application/routing/route-handlers#convention
export async function GET(request: Request, { params }: { params: Promise<{ route: string[] }> }) {
	try {
		console.log('trying...', request.url)

		const { route } = await params

		if (route.length === 0) {
			return new Response('Not Found', { status: 404 })
		}

		// VS Code / Electron feed: /api/update/<platform>/<quality>/<clientCommit>
		// See abstractUpdateService.createUpdateURL in the Spud IDE fork.
		if (route.length === 5) {
			const [_api, _update, platform, quality, clientCommit] = route
			if (_api !== 'api' || _update !== 'update') {
				return new Response('Not Found', { status: 404 })
			}
			const input = validateInput(platform, quality)
			if (!input) {
				return new Response(null, { status: 204 })
			}
			if (!latestCommit || clientCommit === latestCommit) {
				return new Response(null, { status: 204 })
			}
			const body = updateJsonForPlatform(platform)
			if (!body) {
				// Hashes / server config not published yet — avoid a broken auto-update.
				return new Response(null, { status: 204 })
			}
			return Response.json(body)
		}

		// Legacy Void ping: /api/v0/<commit> — kept for compatibility with older forks.
		if (route.length === 3) {
			const [_api, _v0, clientCommit] = route
			if (_api !== 'api' || _v0 !== 'v0') {
				return new Response('Not Found', { status: 404 })
			}
			if (!latestCommit || clientCommit === latestCommit) {
				return Response.json({ hasUpdate: false })
			}
			return Response.json({
				hasUpdate: true,
				downloadMessage: `A new Spud build is available (${latestVersionTagForMessage}). [Download Spud](${downloadPage}). Please reinstall — auto-updates may be disabled on some platforms.`,
			})
		}

		return new Response('Not Found', { status: 404 })
	} catch (e) {
		console.error('ERROR:', e)
		return new Response(null, { status: 500 })
	}
}
