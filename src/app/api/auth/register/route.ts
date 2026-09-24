import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { registerSchema } from '@/lib/domain/schemas'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
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
    const u = user as { id: string; email: string; name: string | null; avatarUrl?: string | null }
    const res = NextResponse.json({ user: { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl ?? null } })
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Register API Error]:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'An unexpected error occurred during registration.', code: 'server_error' }, { status: 500 })
  }
}
