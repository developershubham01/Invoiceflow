import { NextRequest, NextResponse } from 'next/server'
import { verifyPasswordResetOtp } from '@/lib/server/auth-service'
import { rateLimit, clientIp } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (!rateLimit(`verify-otp:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many verification attempts. Please try again in a minute.', code: 'rate_limited' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    const otp = String(body?.otp || '').trim()

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and verification code are required.', code: 'validation' }, { status: 400 })
    }

    const result = await verifyPasswordResetOtp(email, otp)
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Invalid verification code.', code: 'verification_failed' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      resetToken: result.resetToken,
      message: 'Code verified successfully.',
    })
  } catch (err) {
    console.error('[Verify OTP Error]:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'An unexpected error occurred during OTP verification.', code: 'server_error' }, { status: 500 })
  }
}
