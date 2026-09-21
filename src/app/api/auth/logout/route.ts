import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { clearSessionCookie, getTokenFromRequest } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (token) {
    await prisma.session.deleteMany({ where: { token } })
  }
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearSessionCookie())
  return res
}
