import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'
import './ui/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Register the service worker. This is what makes the app installable and, more
 * importantly, what makes it open instantly with no signal — which is the
 * normal state of a phone abroad without a roaming plan.
 *
 * `immediate` activates a new build on the next load rather than waiting for
 * every tab to close, so a bug fix actually reaches people.
 */
registerSW({ immediate: true })
