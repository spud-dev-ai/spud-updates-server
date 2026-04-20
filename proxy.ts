import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * CORS for update endpoints (desktop app / tooling may probe from various contexts).
 * Next 16 renamed the `middleware` file convention to `proxy` — this is the same CORS layer.
 */
export function proxy(request: NextRequest) {
	if (!request.nextUrl.pathname.startsWith('/api')) {
		return NextResponse.next()
	}
	if (request.method === 'OPTIONS') {
		return new NextResponse(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
				'Access-Control-Max-Age': '86400',
			},
		})
	}
	const res = NextResponse.next()
	res.headers.set('Access-Control-Allow-Origin', '*')
	res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
	return res
}

export const config = {
	matcher: '/api/:path*',
}
