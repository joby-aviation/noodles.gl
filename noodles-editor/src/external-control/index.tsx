
// External Control Component
// React component to initialize and manage external control


import React, { useEffect, useState } from 'react'
import { ExternalControl } from './api'

export interface ExternalControlProps {
  enabled?: boolean
  autoConnect?: boolean
  host?: string
  port?: number
  debug?: boolean
  onStatusChange?: (connected: boolean) => void
  onError?: (error: Error) => void
}

// External Control Provider Component
 // Initializes the external control system when mounted
export const ExternalControlProvider: React.FC<ExternalControlProps> = ({
  enabled = true,
  autoConnect = false,
  host = 'localhost',
  port = 8765,
  debug = false,
  onStatusChange,
  onError,
}) => {
  const [isInitialized, setIsInitialized] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled) return

    let control: ExternalControl | null = null

    const initialize = async () => {
      try {
        control = new ExternalControl({
          host,
          port,
          autoConnect,
          debug,
        })

        // Set up event handlers
        control.onStatusChange((connected) => {
          setIsConnected(connected)
          onStatusChange?.(connected)
        })

        control.onError((err) => {
          setError(err)
          onError?.(err)
        })

        // Initialize the control
        await control.initialize()
        setIsInitialized(true)

        // Make it available globally for debugging
        if (debug) {
          (window as any).__externalControl = control
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        onError?.(error)
      }
    }

    initialize()

    // Cleanup on unmount
    return () => {
      if (control) {
        control.dispose()
        if (debug) {
          delete (window as any).__externalControl
        }
      }
    }
  }, [enabled, autoConnect, host, port, debug])

  // Render status indicator if in debug mode
  if (!debug) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 10,
        right: 10,
        padding: '8px 12px',
        background: isConnected ? '#4CAF50' : error ? '#f44336' : '#666',
        color: 'white',
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'monospace',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      External Control: {
        isConnected ? 'Connected' :
        error ? 'Error' :
        isInitialized ? 'Disconnected' :
        'Initializing...'
      }
    </div>
  )
}

// Export everything from the API
export * from './api'
export * from './message-protocol'
export * from './pipeline-tools'
export * from './tool-adapter'