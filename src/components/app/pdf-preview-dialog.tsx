'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import type { UnifiedDocumentModel } from '@/lib/pdf/document-model'
import { pdfFileName } from '@/lib/pdf/document-model'
import { DOC_TEMPLATES, DEFAULT_TEMPLATE_ID, getDocTemplate } from '@/lib/domain/doc-templates'

/**
 * PDF preview: renders the UnifiedDocumentModel with jsPDF into a blob URL shown in an
 * iframe (offline generation, CANON §13). Download via jsPDF .save().
 * A template switcher lets the user preview/export any of the 8 templates without
 * changing the company default (Settings → My Company → Document templates).
 */
export function PdfPreviewDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  model: UnifiedDocumentModel | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState<string>('')

  const companyTemplate = model
    ? model.kind === 'INVOICE'
      ? model.company.invoiceTemplate
      : model.company.quotationTemplate
    : null

  // Reset the override whenever a different document is opened.
  useEffect(() => {
    setOverride('')
  }, [open, model?.number, model?.kind])

  const effectiveModel = useMemo<UnifiedDocumentModel | null>(() => {
    if (!model || !override) return model
    const company =
      model.kind === 'INVOICE'
        ? { ...model.company, invoiceTemplate: override }
        : { ...model.company, quotationTemplate: override }
    return { ...model, company }
  }, [model, override])

  useEffect(() => {
    if (!open || !effectiveModel) return
    let revoke: string | null = null
    setUrl(null)
    setError(null)
    void (async () => {
      try {
        const { renderDocumentPdf, pdfToBlobUrl } = await import('@/lib/pdf/render')
        const doc = renderDocumentPdf(effectiveModel)
        const blobUrl = pdfToBlobUrl(doc)
        revoke = blobUrl
        setUrl(blobUrl)
      } catch (err) {
        setError((err as Error).message || 'Could not generate PDF')
      }
    })()
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [open, effectiveModel])

  const download = () => {
    if (!effectiveModel) return
    void (async () => {
      const { renderDocumentPdf, downloadPdf } = await import('@/lib/pdf/render')
      downloadPdf(renderDocumentPdf(effectiveModel), pdfFileName(effectiveModel))
    })()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-3xl flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Document preview — {model?.number}</DialogTitle>
          <DialogDescription>Generated locally on this device (offline-capable).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="pdf-template" className="text-xs text-muted-foreground">Template</Label>
          <Select value={override} onValueChange={(v) => setOverride(v === 'company' ? '' : v)}>
            <SelectTrigger id="pdf-template" className="h-8 w-[260px] text-xs">
              <SelectValue placeholder={`Company default — ${getDocTemplate(companyTemplate || DEFAULT_TEMPLATE_ID).name}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company">
                Company default — {getDocTemplate(companyTemplate || DEFAULT_TEMPLATE_ID).name}
              </SelectItem>
              {DOC_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {override && (
            <span className="text-[11px] text-muted-foreground">This preview only — saved default is unchanged.</span>
          )}
        </div>
        <div className="min-h-0 flex-1 rounded-lg border bg-muted/40">
          {error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>
          ) : url ? (
            <iframe title="PDF preview" src={url} className="h-full w-full rounded-lg" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Rendering PDF…
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={download} disabled={!model || Boolean(error)}>Download PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
