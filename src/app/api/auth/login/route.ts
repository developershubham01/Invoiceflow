import { NextRequest, NextResponse } from 'next/server'
import {
  findUserByEmail,
  verifyUserPassword,
  checkLoginLockout,
  recordFailedLogin,
  resetLoginAttempts,
  hasCompanyProfile,
} from '@/lib/server/auth-service'
import { createSession, sessionCookie } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body', code: 'bad_request' }, { status: 400 })
    }

    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (!email || !password) {
      return NextResponse.json({ error: 'Please enter both email and password.', code: 'validation' }, { status: 400 })
    }

    // 1. Check server-side 10-minute lockout
    const lockStatus = await checkLoginLockout(email)
    if (lockStatus.locked) {
      return NextResponse.json({
        error: 'Too many failed login attempts. Please try again after 10 minutes.',
        code: 'account_locked',
        remainingSeconds: lockStatus.remainingSeconds,
      }, { status: 423 })
    }

    // 2. Find user
    const user = await findUserByEmail(email)
    if (!user) {
      // Record failed attempt for existing or non-existing accounts to thwart enumeration
      const failStatus = await recordFailedLogin(email)
      if (failStatus.locked) {
        return NextResponse.json({
          error: 'Too many failed login attempts. Please try again after 10 minutes.',
          code: 'account_locked',
          remainingSeconds: failStatus.remainingSeconds,
        }, { status: 423 })
      }
      return NextResponse.json({
        error: 'Invalid email or password.',
        code: 'invalid_credentials',
        remainingAttempts: failStatus.remainingAttempts,
      }, { status: 401 })
    }

    // 3. Verify password
    const passwordValid = await verifyUserPassword(user, password)
    if (!passwordValid) {
      const failStatus = await recordFailedLogin(email)
      if (failStatus.locked) {
        return NextResponse.json({
          error: 'Too many failed login attempts. Please try again after 10 minutes.',
          code: 'account_locked',
          remainingSeconds: failStatus.remainingSeconds,
        }, { status: 423 })
      }
      return NextResponse.json({
        error: 'Invalid email or password.',
        code: 'invalid_credentials',
        remainingAttempts: failStatus.remainingAttempts,
      }, { status: 401 })
    }

    // 4. Successful login: reset failed attempt counter and lockout
    await resetLoginAttempts(email)

    // 5. Check if company profile exists (NEVER create during login)
    const hasCompany = await hasCompanyProfile(user.id)

    // 6. Create session & set cookie
    const session = await createSession(user.id)
    const res = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
      },
      hasCompanyProfile: hasCompany,
    })
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Login API Error]:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'An unexpected error occurred during login.', code: 'server_error' }, { status: 500 })
  }
}
