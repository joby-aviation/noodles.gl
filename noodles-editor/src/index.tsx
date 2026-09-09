/// <reference types="./index.d.ts" />
import 'primeicons/primeicons.css'
import 'primereact/resources/themes/viva-dark/theme.css'
import ReactDOM from 'react-dom/client'
import App from './app'
import './index.css'
import { keyboardManager } from './noodles/utils/keyboard-manager'
import reportWebVitals from './reportWebVitals'
import { analytics } from './utils/analytics'

// Initialize analytics
analytics.initialize()

// Show user-visible error notifications
function showErrorNotification(message: string, details?: string) {
  console.error('[Noodles] Error:', message, details)

  const banner = document.createElement('div')
  banner.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #2d2d2d;
    color: #ff6b6b;
    padding: 16px 20px;
    border-radius: 8px;
    z-index: 10000;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    max-width: 400px;
    border: 1px solid #ff6b6b;
  `
  banner.innerHTML = `
    <div style="display: flex; align-items: start; gap: 12px;">
      <span style="font-size: 20px;">❌</span>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">${message}</div>
        ${details ? `<div style="font-size: 11px; color: #999; font-family: monospace;">${details}</div>` : ''}
      </div>
      <button style="
        background: transparent;
        border: none;
        color: #999;
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        line-height: 1;
      ">×</button>
    </div>
  `

  const dismissBtn = banner.querySelector('button')
  dismissBtn?.addEventListener('click', () => banner.remove())

  document.body.appendChild(banner)

  // Auto-dismiss after 15 seconds
  setTimeout(() => banner.remove(), 15000)
}

// Log uncaught errors and unhandled promise rejections
window.addEventListener('error', e => {
  // Ignore benign ResizeObserver errors - these are harmless browser warnings
  // that occur when ResizeObserver callbacks trigger layout changes
  const message = e.error?.message || e.message || ''
  if (message.includes('ResizeObserver loop')) {
    e.preventDefault()
    return
  }
  console.error('[Noodles] uncaught error:', e.error ?? e.message)
  showErrorNotification('Uncaught error occurred', message)
})
window.addEventListener('unhandledrejection', e => {
  console.error('[Noodles] unhandled rejection:', e.reason)
  const message = e.reason?.message || String(e.reason)
  showErrorNotification('Unhandled promise rejection', message)
})

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

// Listen for analytics errors and make them visible to the user
window.addEventListener('noodles:analytics-error', ((e: CustomEvent) => {
  const { message, error } = e.detail
  const details = error?.message || error?.toString()
  showErrorNotification(message, details)
}) as EventListener)
