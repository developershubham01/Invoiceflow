// InvoiceFlow — Hash router (CANON §2 / docs/32-ROUTES.md)
// The sandbox preview serves only `/`, so the SPA uses hash-based navigation that
// mirrors the production route table.

import { useCallback, useEffect, useState } from 'react'

export interface Route {
  segments: string[]
  raw: string
}

function parseHash(): Route {
  const raw = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#\/?/, '')
  return { segments: raw.split('/').filter(Boolean), raw }
}

export function navigate(path: string): void {
  const clean = path.replace(/^#/, '').replace(/^\/+/, '')
  window.location.hash = clean ? `#/${clean}` : '#/dashboard'
}

export function hrefFor(path: string): string {
  const clean = path.replace(/^#/, '').replace(/^\/+/, '')
  return clean ? `#/${clean}` : '#/dashboard'
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash())
  const sync = useCallback(() => setRoute(parseHash()), [])
  useEffect(() => {
    window.addEventListener('hashchange', sync)
    if (!window.location.hash) navigate('dashboard')
    return () => window.removeEventListener('hashchange', sync)
  }, [sync])
  return route
}
