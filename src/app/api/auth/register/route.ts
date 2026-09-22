import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { registerSchema } from '@/lib/domain/schemas'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  if (!rateLimit(`register:${clientIp(req)}`)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
  }
  const body = await req.json().catch(() => null)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'validation' }, { status: 400 })
  }
  const { name, email, password } = parsed.data
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists', code: 'email_taken' }, { status: 409 })
  }
  const user = await prisma.user.create({
    data: { email: email.toLowerCase(), name, passwordHash: hashPassword(password) },
  })
  const session = await createSession(user.id)
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } })
  res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
  return res
}
