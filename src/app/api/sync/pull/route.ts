import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/server/auth'

/** Pull change-log deltas since a cursor (CANON §9). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspace_id')
  const cursor = Number(url.searchParams.get('cursor') ?? '0')
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? '500')))
  if (!workspaceId || !Number.isFinite(cursor)) {
    return NextResponse.json({ error: 'workspace_id and cursor are required', code: 'validation' }, { status: 400 })
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id },
  })
  if (!membership) {
    return NextResponse.json({ error: 'You are not a member of this workspace', code: 'forbidden' }, { status: 403 })
  }

  const changes = await prisma.changeLog.findMany({
    where: { workspaceId, seq: { gt: cursor } },
    orderBy: { seq: 'asc' },
    take: limit,
  })

  return NextResponse.json({
    changes: changes.map((c) => ({ seq: c.seq, entity: c.entity, op: c.op, record: JSON.parse(c.payload) })),
    next_cursor: changes.length ? changes[changes.length - 1].seq : cursor,
    server_time: new Date().toISOString(),
  })
}
