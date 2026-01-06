// External Control Button
// Toolbar button for opening the external control sharing dialog

import React, { useState, useEffect } from 'react'
import { SharingDialog } from './sharing-dialog'
import { sessionManager } from '../session-manager'
import s from './external-control-button.module.css'

export const ExternalControlButton: React.FC = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [hasActiveSessions, setHasActiveSessions] = useState(false)

  useEffect(() => {
    // Load persisted sessions on mount
    sessionManager.loadSessions()
    checkActiveSessions()

    // Check periodically for expired sessions
    const interval = setInterval(checkActiveSessions, 60000) // Every minute

    return () => clearInterval(interval)
  }, [])

  const checkActiveSessions = () => {
    const sessions = sessionManager.getActiveSessions()
    setHasActiveSessions(sessions.length > 0)
  }

  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className={s.externalControlButton}
        title="External Control - Share with AI tools"
      >
        <i className={hasActiveSessions ? "pi pi-shield" : "pi pi-external-link"}
           style={hasActiveSessions ? { color: 'var(--color-success)' } : {}} />
        <span>External Control</span>
        {hasActiveSessions && (
          <span className={s.activeIndicator} />
        )}
      </button>

      <SharingDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false)
          checkActiveSessions()
        }}
      />
    </>
  )
}