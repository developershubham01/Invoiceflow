import { NextRequest, NextResponse } from 'next/server'
import { createPasswordResetOtp } from '@/lib/server/auth-service'
import { rateLimit, clientIp } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (!rateLimit(`forgot-pass:${ip}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please try again in a minute.', code: 'rate_limited' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.', code: 'validation' }, { status: 400 })
    }

    const res = await createPasswordResetOtp(email)
    if (!res.success) {
      const status = res.error?.includes('wait') ? 429 : 404
      return NextResponse.json({ error: res.error || 'Could not send verification code.', code: 'failed' }, { status })
    }

    return NextResponse.json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email address.',
    })
  } catch (err) {
    console.error('[Forgot Password Error]:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'An unexpected error occurred while processing your request.', code: 'server_error' }, { status: 500 })
  }
}
