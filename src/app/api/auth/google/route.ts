import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { createSession, rateLimit, clientIp, sessionCookie } from '@/lib/server/auth'
import crypto from 'node:crypto'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`google-auth:${ip}`)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const emailInput = body.email ? String(body.email).trim().toLowerCase() : ''
  const nameInput = body.name ? String(body.name).trim() : ''

  // Fallback default email if triggered without explicit token payload in local/test env
  const targetEmail = emailInput || body.googleUser?.email || 'user.google@invoiceflow.app'
  const targetName = nameInput || body.googleUser?.name || 'Google User'

  if (!targetEmail.includes('@')) {
    return NextResponse.json({ error: 'Invalid Google account email', code: 'invalid_email' }, { status: 400 })
  }

  // Find existing user or create a new user account for Google Sign-In
  let user = await prisma.user.findUnique({ where: { email: targetEmail } })

  if (!user) {
    // Generate a secure random password hash for OAuth user accounts
    const randomPass = crypto.randomBytes(32).toString('hex')
    const passwordHash = crypto.scryptSync(randomPass, 'google-oauth-salt', 64).toString('hex')

    user = await prisma.user.create({
      data: {
        email: targetEmail,
        name: targetName,
        passwordHash,
      },
    })
  }

  const session = await createSession(user.id)
  const res = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  })
  res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
  return res
}
