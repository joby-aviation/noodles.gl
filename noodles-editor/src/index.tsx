/// <reference types="./index.d.ts" />
import ReactDOM from 'react-dom/client'
import App from './app'
import './index.css'
import { keyboardManager } from './noodles/utils/keyboard-manager'
import reportWebVitals from './reportWebVitals'
import { analytics } from './utils/analytics'

// Initialize analytics
analytics.initialize()

// Initialize keyboard manager
keyboardManager.init()

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  // Called when React catches an error in an Error Boundary
  onCaughtError: (error, errorInfo) => {
    analytics.captureException(error, {
      source: 'react_error_boundary',
      componentStack: errorInfo.componentStack,
    })
  },
  // Called when an error is thrown and not caught by an Error Boundary
  onUncaughtError: (error, errorInfo) => {
    analytics.captureException(error, {
      source: 'react_uncaught',
      componentStack: errorInfo.componentStack,
    })
  },
  // Called when React automatically recovers from errors
  onRecoverableError: (error, errorInfo) => {
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
