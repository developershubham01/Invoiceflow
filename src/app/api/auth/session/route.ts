import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/auth'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ user: null })
  const u = user as { id: string; email: string; name: string | null; avatarUrl?: string | null }
  return NextResponse.json({ user: { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl ?? null } })
}
