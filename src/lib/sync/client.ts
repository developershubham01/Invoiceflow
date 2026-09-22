// InvoiceFlow — Auth + sync API client (dev cloud adapter; CANON §9, §11, §14)

import type { SessionUser } from '@/lib/domain/types'

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
    ;(err as Error & { status?: number }).status = res.status
    ;(err as Error & { code?: string }).code = (body as { code?: string }).code
    throw err
  }
  return body as T
}

// ---------- auth ----------

export async function apiRegister(name: string, email: string, password: string): Promise<{ user: SessionUser }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  return parse(res)
}

export async function apiLogin(email: string, password: string): Promise<{ user: SessionUser }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return parse(res)
}

export async function apiLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

export async function apiSession(): Promise<{ user: SessionUser | null }> {
  const res = await fetch('/api/auth/session')
  return parse(res)
}

export async function apiDeleteAccount(): Promise<void> {
  const res = await fetch('/api/auth/account', { method: 'DELETE' })
  return parse(res)
}

// ---------- workspace ----------

export async function apiClaimWorkspace(workspaceId: string, name: string, deviceId: string): Promise<{ workspace: { id: string; name: string }; cursor: number }> {
  const res = await fetch('/api/workspace/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, name, device_id: deviceId }),
  })
  return parse(res)
}

// ---------- sync ----------

export interface PushOp {
  op_id: string
  entity: string
  entity_id: string
  action: 'upsert' | 'finalize' | 'cancel' | 'delete'
  base_version: number
  payload: unknown
}

export interface PushResult {
  op_id: string
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'number_reassigned'
  record?: unknown
  error?: string
}

export async function apiPush(workspaceId: string, deviceId: string, ops: PushOp[]): Promise<{ results: PushResult[]; server_time: string }> {
  const res = await fetch('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, device_id: deviceId, schema_version: 1, ops }),
  })
  return parse(res)
}

export interface PullChange {
  seq: number
  entity: string
  op: string
  record: Record<string, unknown>
}

export async function apiPull(workspaceId: string, cursor: number, limit = 500): Promise<{ changes: PullChange[]; next_cursor: number; server_time: string }> {
  const res = await fetch(`/api/sync/pull?workspace_id=${encodeURIComponent(workspaceId)}&cursor=${cursor}&limit=${limit}`)
  return parse(res)
}
