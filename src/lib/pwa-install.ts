'use client'

// InvoiceFlow — PWA install affordance (CANON §2: offline-first, installable).
// Captures the browser's `beforeinstallprompt` event (Chrome/Edge/Android) so the
// Settings screen can offer a native one-tap install. For platforms without the
// event (iOS Safari, some desktop browsers) we expose a coarse platform hint so
// the UI can show manual "Add to Home Screen" instructions instead.
//
// Implemented as a tiny module-level external store so every consumer re-renders
// on installability changes without a context provider.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PwaPlatform = 'ios' | 'android' | 'desktop'

export interface PwaInstallState {
  /** deferred native prompt is available → show the install button */
  canInstall: boolean
  /** app is already running as an installed (standalone) window */
  isStandalone: boolean
  /** platform hint for manual-install fallback instructions */
  platform: PwaPlatform
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
let snapshot: PwaInstallState = { canInstall: false, isStandalone: false, platform: 'desktop' }

function detectPlatform(): PwaPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
  if (isIOS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

function recompute() {
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true)
  snapshot = { canInstall: deferredPrompt != null, isStandalone, platform: detectPlatform() }
}

function notify() {
  recompute()
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  recompute()
  window.addEventListener('beforeinstallprompt', (e) => {
    // prevent Chrome's mini-infobar — we surface our own install UI instead
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
  // some browsers flip standalone without a reload (e.g. desktop install flow)
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', notify)
}

export function subscribePwaInstall(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** SSR-safe snapshot (always "not installed / no prompt" on the server). */
export function getServerPwaInstallState(): PwaInstallState {
  return { canInstall: false, isStandalone: false, platform: 'desktop' }
}

export function getPwaInstallState(): PwaInstallState {
  return snapshot
}

export type PwaInstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

/** Shows the native install dialog; resolves with the user's choice. */
export async function promptPwaInstall(): Promise<PwaInstallOutcome> {
  if (!deferredPrompt) return 'unavailable'
  try {
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    notify()
    return outcome
  } catch {
    return 'unavailable'
  }
}
