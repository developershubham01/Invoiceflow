// InvoiceFlow — Device identity (CANON §3)

const DEVICE_ID_KEY = 'invoiceflow_device_id'

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = window.localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}
