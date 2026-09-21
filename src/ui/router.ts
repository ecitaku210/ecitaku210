import { useEffect, useState } from 'react'

/**
 * A hash router in 40 lines instead of a dependency.
 *
 * The hash is deliberate: the app is a static bundle that has to work from a
 * `file://` URL, a GitHub Pages subpath, and offline from the home screen.
 * Path-based routing needs a server that rewrites unknown paths to index.html;
 * `#/trip/123` needs nothing at all.
 */

export type Route =
  | { name: 'home' }
  | { name: 'trip'; tripId: string }
  | { name: 'expense'; tripId: string; expenseId: string | null }
  | { name: 'settle'; tripId: string }
  | { name: 'share'; tripId: string }
  | { name: 'people'; tripId: string }
  | { name: 'import'; payload: string | null }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const [pathPart = '', queryPart = ''] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const query = new URLSearchParams(queryPart)

  if (segments[0] === 'import') return { name: 'import', payload: query.get('d') }

  if (segments[0] === 'trip' && segments[1]) {
    const tripId = decodeURIComponent(segments[1])
    switch (segments[2]) {
      case undefined:
        return { name: 'trip', tripId }
      case 'settle':
        return { name: 'settle', tripId }
      case 'share':
        return { name: 'share', tripId }
      case 'people':
        return { name: 'people', tripId }
      case 'expense':
        return {
          name: 'expense',
          tripId,
          expenseId: segments[3] && segments[3] !== 'new' ? decodeURIComponent(segments[3]) : null,
        }
      default:
        return { name: 'trip', tripId }
    }
  }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to: string): void {
  window.location.hash = to
}

/** Replaces the entry so the back button does not return to a consumed link. */
export function replace(to: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${to}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function back(): void {
  if (window.history.length > 1) window.history.back()
  else navigate('/')
}
