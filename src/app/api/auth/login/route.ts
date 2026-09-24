import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { loginSchema } from '@/lib/domain/schemas'
import { createSession, rateLimit, clientIp, sessionCookie, verifyPassword } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
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
    const user = await prisma.user.findUnique({ where: { email: emailLower } })

    if (!user) {
      return NextResponse.json({ error: 'No account found with this email. Please Sign Up first.', code: 'invalid_credentials' }, { status: 401 })
    }
    if (!verifyPassword(parsed.data.password, user.passwordHash)) {
      return NextResponse.json({ error: 'Invalid password. Please try again.', code: 'invalid_credentials' }, { status: 401 })
    }

    const session = await createSession(user.id)
    const u = user as { id: string; email: string; name: string | null; avatarUrl?: string | null }
    const res = NextResponse.json({ user: { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl ?? null } })
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Login API Error]:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'An unexpected error occurred during login.', code: 'server_error' }, { status: 500 })
  }
}
