import { NextRequest, NextResponse } from 'next/server'
import { resetPasswordWithToken } from '@/lib/server/auth-service'
import { rateLimit, clientIp } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (!rateLimit(`reset-pass:${ip}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    const resetToken = String(body?.resetToken || '').trim()
    const newPassword = String(body?.newPassword || '')
    const confirmPassword = String(body?.confirmPassword || '')

    if (!email || !resetToken || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: 'All fields are required.', code: 'validation' }, { status: 400 })
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match.', code: 'password_mismatch' }, { status: 400 })
    }

    const result = await resetPasswordWithToken(email, resetToken, newPassword)
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Password reset failed.', code: 'reset_failed' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. Please sign in with your new password.',
    })
  } catch (err) {
    console.error('[Reset Password Error]:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'An unexpected error occurred while resetting your password.', code: 'server_error' }, { status: 500 })
  }
}
