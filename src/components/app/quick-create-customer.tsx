'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { saveCustomer } from '@/lib/db/repositories'
import { customerSchema } from '@/lib/domain/schemas'
import { INDIAN_STATES, stateCodeFromGstin } from '@/lib/domain/gst'
import { toast } from 'sonner'

export function QuickCreateCustomer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (customerId: string) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setName('')
    setPhone('')
    setGstin('')
    setStateCode('')
  }

  const submit = async () => {
    const { getActiveWorkspace } = await import('@/lib/db/repositories')
    const ws = await getActiveWorkspace()
    if (!ws) return
    const parsed = customerSchema.safeParse({ business_name: name, phone, gstin, state_code: stateCode, type: gstin ? 'BUSINESS' : 'INDIVIDUAL' })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid details')
      return
    }
    setSaving(true)
    try {
      const state = INDIAN_STATES.find((s) => s.code === stateCode)
      const customer = await saveCustomer(ws.id, {
        ...parsed.data,
        business_name: parsed.data.business_name,
        state_code: stateCode || stateCodeFromGstin(gstin) || null,
        state_name: state?.name ?? null,
      })
      toast.success('Customer added', { description: customer.business_name })
      reset()
      onOpenChange(false)
      onCreated(customer.id)
    } catch (err) {
      toast.error('Could not save customer', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick add customer</DialogTitle>
          <DialogDescription>Saved locally immediately — syncs when online.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qc-name">Name *</Label>
            <Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Business or person" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-phone">Phone</Label>
              <Input id="qc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXX XXXXX" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-gstin">GSTIN</Label>
              <Input id="qc-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27AAAAA0000A1Z5" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Select value={stateCode} onValueChange={setStateCode}>
              <SelectTrigger><SelectValue placeholder="Select state (for GST)" /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Add customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
