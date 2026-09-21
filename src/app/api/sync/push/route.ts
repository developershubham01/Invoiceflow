import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/server/auth'
import { applyOp, type OpInput } from '@/lib/server/sync-server'

const SCHEMA_VERSION = 1

/** Push outbox operations (CANON §9). Idempotent per op_id; CAS conflicts reported per op. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorized()

  const body = await req.json().catch(() => null) as {
    workspace_id?: string
    schema_version?: number
    ops?: OpInput[]
  } | null

  if (!body?.workspace_id || !Array.isArray(body.ops)) {
    return NextResponse.json({ error: 'workspace_id and ops are required', code: 'validation' }, { status: 400 })
  }
  if (body.schema_version !== SCHEMA_VERSION) {
    return NextResponse.json({ error: 'Schema version mismatch — please update the app', code: 'schema_version' }, { status: 409 })
  }
  if (body.ops.length > 100) {
    return NextResponse.json({ error: 'Too many ops in one batch (max 100)', code: 'validation' }, { status: 400 })
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: body.workspace_id, userId: user.id },
  })
  if (!membership) {
    return NextResponse.json({ error: 'You are not a member of this workspace', code: 'forbidden' }, { status: 403 })
  }

  const results: Array<{ op_id: string; status: string; record?: unknown; error?: string }> = []
  for (const op of body.ops.slice(0, 100)) {
    if (!op?.op_id || !op.entity || !op.entity_id || !op.action) {
      results.push({ op_id: String(op?.op_id ?? ''), status: 'rejected', error: 'Malformed op' })
      continue
    }
    try {
      const outcome = await applyOp(body.workspace_id, membership.role, op)
      results.push(outcome)
    } catch (err) {
      // Validation-level failures are 'rejected'; unexpected errors fail the op for retry.
      results.push({ op_id: op.op_id, status: 'rejected', error: (err as Error).message })
    }
  }

  return NextResponse.json({ results, server_time: new Date().toISOString() })
}
