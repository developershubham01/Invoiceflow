import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`google-auth:${ip}`)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const emailInput = body.email ? String(body.email).trim().toLowerCase() : ''
  const nameInput = body.name ? String(body.name).trim() : ''

  const targetEmail = emailInput || body.googleUser?.email || ''
  const targetName = nameInput || body.googleUser?.name || ''

  if (!targetEmail || !targetEmail.includes('@')) {
    return NextResponse.json({ error: 'Invalid Google account email', code: 'invalid_email' }, { status: 400 })
  }

  // Find existing user or create a new user account for Google Sign-In
  let user = await prisma.user.findUnique({ where: { email: targetEmail } })

  if (!user) {
    // Use the proper hashPassword function (which generates a random salt) for OAuth accounts
    const randomPassword = crypto.randomUUID() + crypto.randomUUID()
    user = await prisma.user.create({
      data: {
        email: targetEmail,
        name: targetName || targetEmail.split('@')[0],
        passwordHash: hashPassword(randomPassword),
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
