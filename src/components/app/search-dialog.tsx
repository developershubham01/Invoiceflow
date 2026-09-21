'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { navigate } from '@/lib/router'
import { useActiveWorkspace } from '@/lib/hooks/app-hooks'
import { SHORTCUTS } from '@/lib/hooks/use-shortcuts'
import { formatMoneyCompact } from '@/lib/domain/money'
import { FileText, Package, Plus, Receipt, Search, UserRound } from 'lucide-react'

export function SearchDialog() {
  const [open, setOpen] = useState(false)
  const ws = useActiveWorkspace()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const results = useLiveQuery(async () => {
    if (!ws || !open) return null
    const [invoices, quotations, customers, products] = await Promise.all([
      getDb().invoices.where('workspace_id').equals(ws.id).filter((i) => !i.deleted_at).limit(50).toArray(),
      getDb().quotations.where('workspace_id').equals(ws.id).filter((q) => !q.deleted_at).limit(50).toArray(),
      getDb().customers.where('workspace_id').equals(ws.id).filter((c) => !c.deleted_at).toArray(),
      getDb().products.where('workspace_id').equals(ws.id).filter((p) => !p.deleted_at).toArray(),
    ])
    return { invoices, quotations, customers, products }
  }, [ws?.id, open])

  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  const groups = useMemo(() => {
    if (!results) return []
    const inv = results.invoices.slice(0, 5).map((i) => ({
      id: i.id, label: i.number, sub: i.customer_name_snapshot ?? '', amount: formatMoneyCompact(i.grand_total_paise), path: `invoices/${i.id}`,
    }))
    const q = results.quotations.slice(0, 5).map((x) => ({
      id: x.id, label: x.number, sub: x.customer_name_snapshot ?? '', amount: formatMoneyCompact(x.grand_total_paise), path: `quotations/${x.id}`,
    }))
    const c = results.customers.slice(0, 5).map((x) => ({ id: x.id, label: x.business_name, sub: x.code ?? '', amount: '', path: `customers/${x.id}` }))
    const p = results.products.slice(0, 5).map((x) => ({ id: x.id, label: x.name, sub: x.sku ?? '', amount: formatMoneyCompact(x.selling_price_paise), path: 'products' }))
    return [
      { heading: 'Recent Invoices', icon: Receipt, items: inv },
      { heading: 'Recent Quotations', icon: FileText, items: q },
      { heading: 'Customers', icon: UserRound, items: c },
      { heading: 'Products & Services', icon: Package, items: p },
    ].filter((g) => g.items.length > 0)
  }, [results])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 px-0 sm:w-56 sm:justify-start sm:gap-2 sm:px-3 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Search (Ctrl+K)"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:flex">
          Ctrl K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search invoices, quotations, customers, products…" />
        <CommandList className="max-h-[60vh] scrollbar-thin">
          {results === null ? null : (
            <>
              <CommandEmpty>No results found.</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.heading} heading={g.heading}>
                  {g.items.map((item) => (
                    <CommandItem key={item.id} value={`${item.label} ${item.sub}`} onSelect={() => go(item.path)}>
                      <g.icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">{item.sub}</span>
                      {item.amount ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{item.amount}</span> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              <CommandGroup heading="Actions">
                <CommandItem onSelect={() => go('invoices/new')}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New invoice
                </CommandItem>
                <CommandItem onSelect={() => go('quotations/new')}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New quotation
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Keyboard shortcuts">
                {SHORTCUTS.map((s) => (
                  <CommandItem key={s.keys} disabled className="opacity-70">
                    <kbd className="mr-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">{s.keys}</kbd>
                    {s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
