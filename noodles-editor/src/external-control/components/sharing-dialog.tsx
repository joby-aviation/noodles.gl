// External Control Sharing Dialog
// UI for creating and managing external control sessions

import React, { useState, useEffect } from 'react'
import { sessionManager, type Session } from '../session-manager'
import { Copy, X, ExternalLink, Shield, Clock, Trash2 } from 'lucide-react'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold">External Control Sessions</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {/* Create new session */}
          <div className="mb-6">
            <h3 className="text-sm font-medium mb-2">Create New Session</h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Session name (optional)"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              />
              <button
                onClick={createNewSession}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
              >
                Create Session
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Sessions expire after 24 hours for security
            </p>
          </div>

          {/* Active sessions */}
          <div>
            <h3 className="text-sm font-medium mb-2">Active Sessions</h3>
            {sessions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Shield className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>No active sessions</p>
                <p className="text-sm mt-1">Create a session to allow external control</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="border rounded-lg p-4 dark:border-gray-700"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-medium">{session.name}</h4>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatTimeRemaining(session.expiresAt)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => revokeSession(session.token)}
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-red-500"
                        title="Revoke session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Connection URL */}
                    <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Connection URL
                        </span>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              sessionManager.generateConnectionUrl(session),
                              session.token + '-url'
                            )
                          }
                          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedToken === session.token + '-url' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <code className="text-xs break-all text-gray-700 dark:text-gray-300">
                        {sessionManager.generateConnectionUrl(session)}
                      </code>
                    </div>

                    {/* Connection command */}
                    <div className="bg-gray-50 dark:bg-gray-800 rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Claude Code Command
                        </span>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              sessionManager.generateConnectionCommand(session),
                              session.token + '-cmd'
                            )
                          }
                          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedToken === session.token + '-cmd' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <code className="text-xs break-all text-gray-700 dark:text-gray-300">
                        {sessionManager.generateConnectionCommand(session)}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              How to connect from Claude Code
            </h3>
            <ol className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
              <li>1. Create a new session above</li>
              <li>2. Copy the connection command</li>
              <li>3. In Claude Code, use the command to connect:</li>
              <li className="ml-4">
                <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs">
                  const client = new NoodlesClient()
                </code>
              </li>
              <li className="ml-4">
                <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs">
                  {`await client.connect('<paste-url-here>')`}
                </code>
              </li>
              <li>4. The session will remain active for 24 hours</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}