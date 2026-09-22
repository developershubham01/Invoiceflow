'use client'

// InvoiceFlow — template gallery thumbnails (Settings → My Company → Document templates)
// Each thumbnail is a miniature CSS mock of the real PDF layout: header geometry,
// table-head treatment and grand-total style all mirror the jsPDF renderer.

import { Check } from 'lucide-react'
import { DOC_TEMPLATES, DEFAULT_TEMPLATE_ID, type DocTemplate } from '@/lib/domain/doc-templates'
import { cn } from '@/lib/utils'

function MockLine({ className }: { className?: string }) {
  return <div className={cn('rounded-full bg-zinc-200/90', className)} aria-hidden="true" />
}

/** Miniature page mock — mirrors the jsPDF layout for one template. */
function TemplateMock({ tpl }: { tpl: DocTemplate }) {
  const s = tpl.swatch
  const fullBleedLeft = tpl.layout === 'sidebar' || tpl.layout === 'split'

  return (
    <div
      className="relative h-28 w-full overflow-hidden rounded-md border border-zinc-200 bg-white"
      aria-hidden="true"
    >
      {/* full-height decorations */}
      {tpl.layout === 'sidebar' && <div className="absolute inset-y-0 left-0 w-2" style={{ background: s.accent }} />}
      {tpl.layout === 'split' && (
        <div className="absolute inset-y-0 left-0 w-[32%] p-1.5" style={{ background: s.accent }}>
          <div className="h-1.5 w-8 rounded-full bg-white/90" />
          <div className="mt-1 h-1 w-6 rounded-full bg-white/50" />
          <div className="absolute bottom-1.5 left-1.5 h-1 w-9 rounded-full bg-white/60" />
        </div>
      )}

      <div className={cn('relative h-full', fullBleedLeft && (tpl.layout === 'sidebar' ? 'pl-2.5' : 'pl-[35%]'))}>
        {/* header zone */}
        <div className="relative h-10">
          {tpl.layout === 'band' && <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: s.accent }} />}
          {tpl.layout === 'block' && (
            <div className="absolute inset-x-0 top-0 flex h-8 items-start justify-between p-1.5" style={{ background: s.accentDark }}>
              <div className="space-y-1">
                <div className="h-1.5 w-11 rounded-full bg-white/90" />
                <div className="h-1 w-8 rounded-full bg-white/50" />
                <div className="h-1 w-9 rounded-full bg-white/50" />
              </div>
              <div className="h-1.5 w-7 rounded-full" style={{ background: s.accent }} />
            </div>
          )}
          {tpl.layout === 'sidebar' && (
            <div className="absolute inset-x-1.5 top-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <div className="h-1.5 w-10 rounded-full" style={{ background: s.accentDark }} />
                <div className="h-1.5 w-6 rounded-full" style={{ background: s.accent }} />
              </div>
              <div className="h-px w-full" style={{ background: s.accent }} />
            </div>
          )}
          {tpl.layout === 'centered' && (
            <div className="absolute inset-x-0 top-1.5 flex flex-col items-center gap-1">
              <div className="h-1.5 w-14 rounded-full" style={{ background: s.accentDark }} />
              <div className="h-1 w-20 rounded-full bg-zinc-200" />
              <div className="mt-0.5 h-px w-24" style={{ background: s.accent }} />
            </div>
          )}
          {tpl.layout === 'corner' && (
            <div className="absolute inset-x-1.5 top-1.5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="h-4 w-4 rounded" style={{ background: s.accent }} />
                  <div className="h-1.5 w-9 rounded-full" style={{ background: s.accentDark }} />
                </div>
                <div className="h-1.5 w-6 rounded-full" style={{ background: s.accent }} />
              </div>
              <div className="mt-1.5 h-[2px] w-full rounded-full" style={{ background: s.accent }} />
            </div>
          )}
          {tpl.layout === 'split' && (
            <div className="absolute inset-x-1.5 top-1.5 space-y-1">
              <div className="h-1.5 w-9 rounded-full" style={{ background: s.accentDark }} />
              <div className="h-1 w-12 rounded-full bg-zinc-200" />
            </div>
          )}
          {tpl.layout === 'minimal' && (
            <div className="absolute inset-x-1.5 top-2 space-y-1">
              <div className="h-[2px] w-full rounded-full" style={{ background: s.accent }} />
              <div className="flex items-center justify-between pt-1">
                <div className="h-1.5 w-10 rounded-full" style={{ background: s.accentDark }} />
                <div className="h-1 w-6 rounded-full bg-zinc-300" />
              </div>
            </div>
          )}
          {tpl.layout === 'stack' && (
            <>
              <div className="absolute inset-x-1.5 top-1.5 flex items-start justify-between">
                <div className="h-1.5 w-9 rounded-full" style={{ background: s.accentDark }} />
                <div className="h-1 w-7 rounded-full bg-zinc-200" />
              </div>
              <div className="absolute inset-x-0 top-5 flex h-3 items-center justify-between px-1.5" style={{ background: s.accent }}>
                <div className="h-1 w-7 rounded-full bg-white/90" />
                <div className="h-1 w-5 rounded-full bg-white/70" />
              </div>
              <div className="absolute inset-x-0 top-8 h-[2px]" style={{ background: s.accentDark }} />
            </>
          )}
        </div>

        {/* items table */}
        <div className="mx-2 overflow-hidden rounded-sm border border-zinc-200">
          <div
            className="h-2.5 border-b"
            style={
              tpl.tableHead === 'accent'
                ? { background: s.accentDark, borderColor: s.accentDark }
                : tpl.tableHead === 'rule'
                  ? { background: '#fff', borderColor: s.accent, borderBottomWidth: 2 }
                  : { background: s.paper, borderColor: '#e5e7eb' }
            }
          />
          <div className="space-y-1 px-1.5 py-1">
            <MockLine className="h-1 w-3/4" />
            <MockLine className="h-1 w-2/3" />
            <MockLine className="h-1 w-4/5" />
          </div>
        </div>

        {/* grand total */}
        {tpl.totals === 'outline' ? (
          <div className="mx-2 mt-1.5 flex items-center justify-between rounded-sm border px-1.5 py-1" style={{ borderColor: s.accent }}>
            <div className="h-1 w-8 rounded-full" style={{ background: s.accent }} />
            <div className="h-1.5 w-9 rounded-full" style={{ background: s.accentDark }} />
          </div>
        ) : (
          <div
            className="mx-2 mt-1.5 flex items-center justify-between rounded-sm px-1.5 py-1"
            style={{
              background: tpl.totals === 'dark' ? s.accentDark : s.totalFill,
              borderBottom: tpl.totals === 'dark' ? `2px solid ${s.accent}` : undefined,
            }}
          >
            <div className="h-1 w-8 rounded-full bg-white/80" />
            <div className="h-1.5 w-9 rounded-full bg-white/90" />
          </div>
        )}
      </div>
    </div>
  )
}

/** Selectable template card used by the Settings gallery. */
export function TemplateThumb({
  tpl,
  selected,
  onSelect,
}: {
  tpl: DocTemplate
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tpl.id)}
      aria-pressed={selected}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-card p-2 text-left transition-all',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary shadow-sm ring-2 ring-primary/25' : 'border-border',
      )}
      title={`${tpl.name} — ${tpl.description}`}
    >
      {selected && (
        <span className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Check className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
      <TemplateMock tpl={tpl} />
      <div className="px-0.5 pb-0.5">
        <p className="flex items-center gap-1.5 text-xs font-medium leading-tight">
          {tpl.name}
          {tpl.id === DEFAULT_TEMPLATE_ID && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-normal uppercase tracking-wide text-muted-foreground">
              default
            </span>
          )}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{tpl.description}</p>
      </div>
    </button>
  )
}

/** Grid of all templates (8) — shared by the Invoice and Quotation tabs. */
export function TemplateGrid({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" role="group" aria-label="Templates">
      {DOC_TEMPLATES.map((tpl) => (
        <TemplateThumb key={tpl.id} tpl={tpl} selected={selected === tpl.id} onSelect={onSelect} />
      ))}
    </div>
  )
}
