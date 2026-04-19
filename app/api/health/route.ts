import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Uptime checks and deploy verification (load balancers, Vercel, etc.). */
export async function GET() {
	return NextResponse.json({
		ok: true,
		service: 'spud-updates-server',
		timestamp: new Date().toISOString(),
	})
}
