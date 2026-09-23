import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { loginSchema } from '@/lib/domain/schemas'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie, verifyPassword } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`login:${ip}`)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
  }
  const body = await req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'validation' }, { status: 400 })
  }

  const emailLower = parsed.data.email.toLowerCase()
  let user = await prisma.user.findUnique({ where: { email: emailLower } })

  if (!user) {
    // Auto-create account if user is signing in for the first time
    user = await prisma.user.create({
      data: {
        email: emailLower,
        name: emailLower.split('@')[0],
        passwordHash: hashPassword(parsed.data.password),
      },
    })
  } else if (!verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid password for this account', code: 'invalid_credentials' }, { status: 401 })
  }

  const session = await createSession(user.id)
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } })
  res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
  return res
}
