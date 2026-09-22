'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import type { UnifiedDocumentModel } from '@/lib/pdf/document-model'
import { pdfFileName } from '@/lib/pdf/document-model'

/**
 * PDF preview: renders the UnifiedDocumentModel with jsPDF into a blob URL shown in an
 * iframe (offline generation, CANON §13). Download via jsPDF .save().
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

  useEffect(() => {
    if (!open || !model) return
    let revoke: string | null = null
    setUrl(null)
    setError(null)
    void (async () => {
      try {
        const { renderDocumentPdf, pdfToBlobUrl } = await import('@/lib/pdf/render')
        const doc = renderDocumentPdf(model)
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
  }, [open, model])

  const download = () => {
    if (!model) return
    void (async () => {
      const { renderDocumentPdf, downloadPdf } = await import('@/lib/pdf/render')
      downloadPdf(renderDocumentPdf(model), pdfFileName(model))
    })()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-3xl flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Document preview — {model?.number}</DialogTitle>
          <DialogDescription>Generated locally on this device (offline-capable).</DialogDescription>
        </DialogHeader>
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
