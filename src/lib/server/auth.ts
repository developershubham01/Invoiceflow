// InvoiceFlow — Dev cloud auth: scrypt password hashing + session cookies (CANON §11)
// In production this adapter is replaced by Supabase Auth; the app-level interface is identical.

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db as prisma } from '@/lib/db'

export const SESSION_COOKIE = 'if_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${key}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':')
  if (!salt || !key) return false
  const derived = scryptSync(password, salt, 64)
  const expected = Buffer.from(key, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { userId, token, expiresAt } })
  return { token, expiresAt }
}

export function sessionCookie(token: string, expiresAt: Date): string {
  // Secure flag only over https (sandbox preview & production); SameSite=Lax for CSRF safety.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function getTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE)?.value ?? null
}

export async function getSessionUser(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  return session.user
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Authentication required', code: 'unauthenticated' }, { status: 401 })
}

// ---------- rate limiting (in-memory token bucket; production: WAF / Supabase) ----------

const buckets = new Map<string, { tokens: number; last: number }>()

export function rateLimit(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: limit, last: now }
  const elapsed = now - b.last
  b.tokens = Math.min(limit, b.tokens + (elapsed / windowMs) * limit)
  b.last = now
  if (b.tokens < 1) {
    buckets.set(key, b)
    return false
  }
  b.tokens -= 1
  buckets.set(key, b)
  return true
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}
