import React, { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Node graph error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          style={{
            padding: '20px',
            backgroundColor: '#2a1f1f',
            border: '1px solid #ff4444',
            borderRadius: '4px',
            color: '#ff8888',
            maxWidth: '600px',
            margin: '20px',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Node Graph Error</h3>
          <p>An error occurred in the node graph. Check the console for details.</p>
          {this.state.error && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer' }}>Error details</summary>
              <pre
                style={{
                  marginTop: '10px',
                  padding: '10px',
                  backgroundColor: '#1a1515',
                  borderRadius: '4px',
                  overflow: 'auto',
                  fontSize: '12px',
                }}
              >
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '15px',
              padding: '8px 16px',
              backgroundColor: '#ff4444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
