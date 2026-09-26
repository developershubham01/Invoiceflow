// InvoiceFlow — CSV export (docs/21-REPORTS.md): UTF-8 BOM, RFC-4180 quoting, CRLF.

export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))]
  return '\uFEFF' + lines.join('\r\n')
}

interface ElectronInvoiceFlowBridge {
  exportFile?(
    data: ArrayBuffer,
    fileName: string,
    contentType?: string,
  ): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
}

export function downloadCsv(fileName: string, csv: string): void {
  const safeFileName = fileName.toLowerCase().endsWith('.csv') ? fileName : `${fileName}.csv`
  const content = csv.startsWith('\uFEFF') ? csv : '\uFEFF' + csv

  // Support Electron native save dialog if running in desktop shell
  if (typeof window !== 'undefined') {
    const desktop = (window as unknown as { invoiceflow?: ElectronInvoiceFlowBridge }).invoiceflow
    if (desktop && typeof desktop.exportFile === 'function') {
      const encoder = new TextEncoder()
      const data = encoder.encode(content).buffer
      void desktop.exportFile(data, safeFileName, 'text/csv')
      return
    }
  }

  if (typeof document === 'undefined') return

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.setAttribute('download', safeFileName)
  a.download = safeFileName
  a.style.display = 'none'

  document.body.appendChild(a)
  a.click()

  setTimeout(() => {
    if (a.parentNode) {
      a.parentNode.removeChild(a)
    }
    URL.revokeObjectURL(url)
  }, 1000)
}
