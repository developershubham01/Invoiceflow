import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { getSessionUser, rateLimit, clientIp, unauthorized } from '@/lib/server/auth'

/**
 * Workspace claim (CANON §11): attach the local guest workspace to the authenticated
 * account. Creates the server workspace + OWNER membership + initial ChangeLog entry.
 * The sync engine then pushes the full local dataset as normal ops.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  if (!rateLimit(`claim:${clientIp(req)}`)) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }
  const body = await req.json().catch(() => null) as { workspace_id?: string; name?: string; device_id?: string } | null
  if (!body?.workspace_id || !body.name) {
    return NextResponse.json({ error: 'workspace_id and name are required', code: 'validation' }, { status: 400 })
  }
  const existing = await prisma.workspace.findUnique({ where: { id: body.workspace_id }, include: { members: true } })
  if (existing) {
    const member = existing.members.find((m) => m.userId === user.id)
    if (!member) {
      return NextResponse.json({ error: 'This workspace belongs to another account', code: 'forbidden' }, { status: 403 })
    }
    await prisma.changeLog.create({
      data: { workspaceId: existing.id, entity: 'workspace', entityId: existing.id, op: 'upsert', payload: JSON.stringify({ id: existing.id, name: existing.name, version: existing.version, updated_at: existing.updatedAt.toISOString(), sync_state: 'synced' }) },
    })
    return NextResponse.json({ workspace: { id: existing.id, name: existing.name }, cursor: 0 })
  }
  const workspace = await prisma.workspace.create({
    data: {
      id: body.workspace_id,
      name: body.name,
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, deviceId: body.device_id ?? null, role: 'OWNER' },
      },
    },
  })
  await prisma.changeLog.create({
    data: { workspaceId: workspace.id, entity: 'workspace', entityId: workspace.id, op: 'upsert', payload: JSON.stringify({ id: workspace.id, name: workspace.name, version: 1, updated_at: workspace.updatedAt.toISOString(), sync_state: 'synced' }) },
  })
  return NextResponse.json({ workspace: { id: workspace.id, name: workspace.name }, cursor: 0 })
}
