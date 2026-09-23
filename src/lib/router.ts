// InvoiceFlow — Path router (HTML5 History API for clean URLs without # tags)

import { useCallback, useEffect, useState } from 'react'

export interface Route {
  segments: string[]
  raw: string
}

function parsePath(): Route {
  if (typeof window === 'undefined') return { segments: ['dashboard'], raw: 'dashboard' }

  // Support legacy hash links if navigated to directly, converting them smoothly
  if (window.location.hash) {
    const legacyHash = window.location.hash.replace(/^#\/?/, '')
    if (legacyHash) {
      window.history.replaceState({}, '', `/${legacyHash}`)
    }
  }

  const path = window.location.pathname.replace(/^\/+/, '')
  const raw = path || 'dashboard'
  return { segments: raw.split('/').filter(Boolean), raw }
}

function notifyLocationChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('locationchange'))
  }
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') return
  const clean = path.replace(/^#/, '').replace(/^\/+/, '')
  const target = `/${clean || 'dashboard'}`
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target)
    notifyLocationChange()
  }
}

export function hrefFor(path: string): string {
  const clean = path.replace(/^#/, '').replace(/^\/+/, '')
  return `/${clean || 'dashboard'}`
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath())

  const sync = useCallback(() => setRoute(parsePath()), [])

  useEffect(() => {
    const handlePopState = () => sync()
    const handleCustomChange = () => sync()

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('locationchange', handleCustomChange)

    // Automatically convert '/' to '/dashboard' cleanly
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({}, '', '/dashboard')
      sync()
    }

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('locationchange', handleCustomChange)
    }
  }, [sync])

  return route
}
