// External Control Sharing Dialog
// UI for creating and managing external control sessions

import React, { useState, useEffect } from 'react'
import { sessionManager, type Session } from '../session-manager'
import {
  CopyIcon,
  Cross2Icon,
  ExternalLinkIcon,
  LockClosedIcon,
  ClockIcon,
  TrashIcon,
} from '@radix-ui/react-icons'
import s from './sharing-dialog.module.css'

interface SharingDialogProps {
  isOpen: boolean
  onClose: () => void
}

export const SharingDialog: React.FC<SharingDialogProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [newSessionName, setNewSessionName] = useState('')
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSessions()
    }
  }, [isOpen])

  const loadSessions = () => {
    setSessions(sessionManager.getActiveSessions())
  }

  const createNewSession = () => {
    const session = sessionManager.createSession(newSessionName || undefined)
    setSessions([...sessions, session])
    setNewSessionName('')
  }

  const copyToClipboard = async (text: string, token: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const revokeSession = (token: string) => {
    sessionManager.revokeSession(token)
    loadSessions()
  }

  const formatTimeRemaining = (expiresAt: Date) => {
    const now = new Date()
    const diff = expiresAt.getTime() - now.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`
    }
    return `${minutes}m remaining`
  }

  if (!isOpen) return null

  return (
    <div className={s.overlay}>
      <div className={s.dialog}>
        {/* Header */}
        <div className={s.header}>
          <div className={s.headerTitle}>
            <LockClosedIcon className={s.headerIcon} />
            <h2 className={s.title}>External Control Sessions</h2>
          </div>
          <button onClick={onClose} className={s.closeButton}>
            <Cross2Icon />
          </button>
        </div>

        {/* Content */}
        <div className={s.content}>
          {/* Create new session */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>Create New Session</h3>
            <div className={s.inputRow}>
              <input
                type="text"
                placeholder="Session name (optional)"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                className={s.input}
              />
              <button onClick={createNewSession} className={s.createButton}>
                Create Session
              </button>
            </div>
            <p className={s.helpText}>Sessions expire after 24 hours for security</p>
          </div>

          {/* Active sessions */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>Active Sessions</h3>
            {sessions.length === 0 ? (
              <div className={s.emptyState}>
                <LockClosedIcon className={s.emptyIcon} />
                <p className={s.emptyText}>No active sessions</p>
                <p className={s.emptyHint}>Create a session to allow external control</p>
              </div>
            ) : (
              <div className={s.sessionList}>
                {sessions.map((session) => (
                  <div key={session.id} className={s.sessionCard}>
                    <div className={s.sessionHeader}>
                      <div className={s.sessionInfo}>
                        <div className={s.sessionName}>{session.name}</div>
                        <div className={s.sessionMeta}>
                          <ClockIcon className={s.clockIcon} />
                          <span>{formatTimeRemaining(session.expiresAt)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => revokeSession(session.token)}
                        className={s.revokeButton}
                        title="Revoke session"
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    {/* Connection URL */}
                    <div className={s.codeBlock}>
                      <div className={s.codeHeader}>
                        <span className={s.codeLabel}>Connection URL</span>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              sessionManager.generateConnectionUrl(session),
                              session.token + '-url'
                            )
                          }
                          className={s.copyButton}
                        >
                          <CopyIcon className={s.copyIcon} />
                          {copiedToken === session.token + '-url' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <code className={s.code}>
                        {sessionManager.generateConnectionUrl(session)}
                      </code>
                    </div>

                    {/* MCP Server Config */}
                    <div className={s.codeBlock}>
                      <div className={s.codeHeader}>
                        <span className={s.codeLabel}>Claude Desktop MCP Config</span>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              sessionManager.generateMcpConfig(),
                              session.token + '-mcp'
                            )
                          }
                          className={s.copyButton}
                        >
                          <CopyIcon className={s.copyIcon} />
                          {copiedToken === session.token + '-mcp' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <code className={s.code}>
                        {sessionManager.generateMcpConfig()}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className={s.instructions}>
            <h3 className={s.instructionsTitle}>
              <ExternalLinkIcon />
              How to connect from Claude Code / Claude Desktop
            </h3>
            <ol className={s.instructionsList}>
              <li>
                Add the MCP config to your Claude Desktop settings:
                <br />
                <code>~/.config/claude/claude_desktop_config.json</code> (Linux/Mac)
                <br />
                <code>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows)
              </li>
              <li>Restart Claude Desktop to load the MCP server</li>
              <li>
                Claude will now have access to Noodles tools like:
                <br />
                <code>getCurrentProject</code>, <code>createNode</code>, <code>connectNodes</code>,
                <br />
                <code>captureVisualization</code>, <code>listOperatorTypes</code>
              </li>
              <li>
                Ask Claude to help you build visualizations:
                <br />
                <em>&quot;Create a scatterplot from the CSV data&quot;</em>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}