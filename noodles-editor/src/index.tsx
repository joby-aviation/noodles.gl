/// <reference types="./index.d.ts" />
import 'primeicons/primeicons.css'
import 'primereact/resources/themes/viva-dark/theme.css'
import ReactDOM from 'react-dom/client'
import App from './app'
import './index.css'
import { keyboardManager } from './noodles/utils/keyboard-manager'
import reportWebVitals from './reportWebVitals'
import { analytics, isIgnoredErrorMessage } from './utils/analytics'
import { installStaleChunkHandler } from './utils/stale-chunk'

// Initialize analytics
analytics.initialize()

// Reload once when a chunk from a previous deploy fails to load
installStaleChunkHandler()

// Log uncaught errors and unhandled promise rejections to the console
window.addEventListener('error', e => {
  // Filter benign ResizeObserver errors - these are harmless browser optimization warnings
  // that occur when ResizeObserver callbacks trigger layout changes. They don't indicate
  // actual problems. This only quiets the console: PostHog's exception autocapture uses its
  // own window.onerror handler, so the PostHog filter lives in before_send (filterExceptionEvent).
  if (isIgnoredErrorMessage(e.error?.message || e.message)) {
    e.preventDefault()
    return
  }
  console.error('[Noodles] uncaught error:', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', e =>
  console.error('[Noodles] unhandled rejection:', e.reason)
)

// Initialize keyboard manager
keyboardManager.init()

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  // Called when React catches an error in an Error Boundary
  onCaughtError: (error, errorInfo) => {
    console.error('[Noodles] React caught error:', error, errorInfo.componentStack)
    analytics.captureException(error, {
      source: 'react_error_boundary',
      componentStack: errorInfo.componentStack,
    })
  },
  // Called when an error is thrown and not caught by an Error Boundary — log to console
  // since this replaces React's default error logging
  onUncaughtError: (error, errorInfo) => {
    console.error('[Noodles] React uncaught error:', error, errorInfo.componentStack)
    analytics.captureException(error, {
      source: 'react_uncaught',
      componentStack: errorInfo.componentStack,
    })
  },
  // Called when React automatically recovers from errors
  onRecoverableError: (error, errorInfo) => {
    console.error('[Noodles] React recoverable error:', error, errorInfo.componentStack)
    analytics.captureException(error, {
      source: 'react_recoverable',
      componentStack: errorInfo.componentStack,
    })
  },
})
root.render(
  //<React.StrictMode>
  <App />
  //</React.StrictMode>
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
