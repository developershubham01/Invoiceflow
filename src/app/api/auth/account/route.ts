import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { clearSessionCookie, getSessionUser, unauthorized } from '@/lib/server/auth'

/** Permanently delete the account and all server-side user data. Local data remains on device. */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  await prisma.user.delete({ where: { id: user.id } })
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearSessionCookie())
  return res
}
