import { NextRequest, NextResponse } from 'next/server'
import { registerNewUser, findUserByEmail, validatePasswordStrength } from '@/lib/server/auth-service'
import { createSession, rateLimit, clientIp, sessionCookie } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (!rateLimit(`register:${ip}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body', code: 'bad_request' }, { status: 400 })
    }

    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const termsAccepted = Boolean(body.termsAccepted)
    const termsVersion = String(body.termsVersion || 'v1.0')

    if (!name) {
      return NextResponse.json({ error: 'Please enter your full name.', code: 'validation' }, { status: 400 })
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.', code: 'validation' }, { status: 400 })
    }

    // Password complexity validation
    const strength = validatePasswordStrength(password)
    if (!strength.valid) {
      return NextResponse.json({ error: strength.error, code: 'weak_password' }, { status: 400 })
    }

    // Mandatory Terms & Conditions Checkbox
    if (!termsAccepted) {
      return NextResponse.json({
        error: 'Please accept the Terms & Conditions and Privacy Policy to continue.',
        code: 'terms_required',
      }, { status: 400 })
    }

    // 1. ONE ACCOUNT PER EMAIL check
    const existing = await findUserByEmail(email)
    if (existing) {
      return NextResponse.json({
        error: 'An account already exists with this email. Please sign in instead.',
        code: 'email_taken',
      }, { status: 409 })
    }

    // Create user in auth.users and Prisma User (same ID, 1:1)
    const user = await registerNewUser({
      name,
      email,
      password,
      termsAccepted,
      termsVersion,
    })

    // Create session (Note: NO company profile is created here)
    const session = await createSession(user.id)
    const res = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
      },
      hasCompanyProfile: false,
    })
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Register API Error]:', err instanceof Error ? err.message : err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred during registration.'
    return NextResponse.json({ error: message, code: 'server_error' }, { status: 500 })
  }
}
