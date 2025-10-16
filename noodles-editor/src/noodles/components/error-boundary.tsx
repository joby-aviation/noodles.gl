import React, { Component, type ReactNode } from 'react'
import s from './error-boundary.module.css'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  maxResets?: number
  resetTimeout?: number
}

interface State {
  hasError: boolean
  error: Error | null
  resetCount: number
  lastResetTime: number
}

const DEFAULT_MAX_RESETS = 3
const DEFAULT_RESET_TIMEOUT = 10000 // 10 seconds

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      resetCount: 0,
      lastResetTime: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Node graph error:', error, errorInfo)

    // Increment reset count if error occurs within timeout period
    const now = Date.now()
    const { lastResetTime, resetCount } = this.state
    const timeout = this.props.resetTimeout ?? DEFAULT_RESET_TIMEOUT

    if (now - lastResetTime < timeout) {
      this.setState({ resetCount: resetCount + 1 })
    } else {
      // Reset the counter if enough time has passed
      this.setState({ resetCount: 0 })
    }
  }

  handleReset = () => {
    const now = Date.now()
    const { resetCount } = this.state
    const maxResets = this.props.maxResets ?? DEFAULT_MAX_RESETS

    if (resetCount >= maxResets) {
      console.warn(
        `Maximum reset attempts (${maxResets}) reached. Please refresh the page or check for underlying issues.`
      )
      return
    }

    console.log('Resetting error boundary...')
    this.setState({
      hasError: false,
      error: null,
      lastResetTime: now,
    })
  }

  render() {
    if (this.state.hasError) {
      const { resetCount } = this.state
      const maxResets = this.props.maxResets ?? DEFAULT_MAX_RESETS
      const canReset = resetCount < maxResets

      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className={s.container}>
          <h3 className={s.title}>Node Graph Error</h3>
          <p>An error occurred in the node graph. Check the console for details.</p>
          {this.state.error && (
            <details className={s.details}>
              <summary className={s.summary}>Error details</summary>
              <pre className={s.errorStack}>
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <div className={s.actions}>
            {canReset ? (
              <>
                <button onClick={this.handleReset} className={s.button}>
                  Reset {resetCount > 0 && `(${resetCount}/${maxResets})`}
                </button>
                {resetCount > 0 && (
                  <p className={s.warning}>
                    Warning: Error has occurred {resetCount} time{resetCount > 1 ? 's' : ''}. If
                    this persists, try refreshing the page.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className={s.errorMessage}>
                  Maximum reset attempts reached. Please refresh the page.
                </p>
                <button onClick={() => window.location.reload()} className={s.refreshButton}>
                  Refresh Page
                </button>
              </>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
