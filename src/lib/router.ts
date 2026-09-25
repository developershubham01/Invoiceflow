// InvoiceFlow — Path router (HTML5 History API for clean URLs without # tags)

import { useCallback, useEffect, useState } from 'react'

export interface Route {
  segments: string[]
  raw: string
}

function parsePath(): Route {
  if (typeof window === 'undefined') return { segments: ['dashboard'], raw: 'dashboard' }

  // Clean any # fragment from the URL immediately so '#' never lingers in the address bar
  if (window.location.hash) {
    const rawHash = window.location.hash
    // Extract any path or search query inside the hash (e.g. #/invoices -> /invoices, #login -> /login)
    const cleanHash = rawHash.replace(/^#[/!]*/, '').trim()

    // If the hash contains an application route (and not oauth tokens), convert it to clean pathname
    if (cleanHash && !cleanHash.startsWith('access_token=') && !cleanHash.startsWith('error=')) {
      const target = cleanHash.startsWith('/') ? cleanHash : `/${cleanHash}`
      window.history.replaceState({}, '', target)
    } else {
      // For bare '#' or tokens, wipe the hash cleanly from the address bar
      const cleanUrl = (window.location.pathname || '/') + (window.location.search || '')
      window.history.replaceState({}, '', cleanUrl)
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
  const clean = path.replace(/^[#/]+/, '').trim()
  const target = clean ? `/${clean}` : '/dashboard'
  // If target is different or if there is any lingering # in the URL, replace with clean target
  if (window.location.pathname !== target || window.location.hash) {
    window.history.pushState({}, '', target)
    notifyLocationChange()
  }
}

export function hrefFor(path: string): string {
  const clean = path.replace(/^[#/]+/, '').trim()
  return clean ? `/${clean}` : '/dashboard'
}

export function usePathRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath())

  const sync = useCallback(() => setRoute(parsePath()), [])

  useEffect(() => {
    const handlePopState = () => sync()
    const handleCustomChange = () => sync()
    const handleHashChange = () => {
      // Whenever any hash is introduced to the URL, strip it immediately
      sync()
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('locationchange', handleCustomChange)
    window.addEventListener('hashchange', handleHashChange)

    // Ensure any hash present on mount is cleared immediately
    if (window.location.hash) {
      sync()
    }

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('locationchange', handleCustomChange)
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [sync])

  return route
}

// Backwards compatibility alias
export const useHashRoute = usePathRoute
