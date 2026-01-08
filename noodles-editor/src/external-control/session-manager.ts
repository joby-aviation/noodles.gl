// Session management for external control
// Handles secure session creation and validation

import { generateMessageId } from './message-protocol'

export interface Session {
  id: string
  token: string
  createdAt: Date
  expiresAt: Date
  name?: string
  permissions?: string[]
}

export class SessionManager {
  private static instance: SessionManager
  private sessions = new Map<string, Session>()
  private readonly SESSION_DURATION = 24 * 60 * 60 * 1000 // 24 hours

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager()
    }
    return SessionManager.instance
  }

  // Create a new session
  createSession(name?: string): Session {
    const id = generateMessageId()
    const token = this.generateSecureToken()

    const session: Session = {
      id,
      token,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.SESSION_DURATION),
      name: name || `Session ${this.sessions.size + 1}`,
      permissions: ['read', 'write', 'execute'] // Full permissions by default
    }

    this.sessions.set(token, session)

    // Store in localStorage for persistence
    this.persistSessions()

    return session
  }

  // Generate a secure connection URL for the session
  generateConnectionUrl(session: Session, host = window.location.hostname, port = 8765): string {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const baseUrl = `${protocol}://${host}:${port}`

    // Include token as query parameter
    const url = new URL(baseUrl)
    url.searchParams.set('token', session.token)
    url.searchParams.set('session', session.id)

    return url.toString()
  }

  // Generate a user-friendly connection command
  generateConnectionCommand(session: Session): string {
    const url = this.generateConnectionUrl(session)
    return `await client.connect('${url}')`
  }

  // Generate MCP server configuration for Claude Desktop
  generateMcpConfig(): string {
    const config = {
      mcpServers: {
        noodles: {
          command: 'node',
          args: ['<path-to>/mcp-proxy.js'],
        },
      },
    }
    return JSON.stringify(config, null, 2)
  }

  // Validate a session token
  validateToken(token: string): boolean {
    const session = this.sessions.get(token)

    if (!session) {
      return false
    }

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      this.sessions.delete(token)
      this.persistSessions()
      return false
    }

    return true
  }

  // Get session by token
  getSession(token: string): Session | null {
    if (!this.validateToken(token)) {
      return null
    }
    return this.sessions.get(token) || null
  }

  // Revoke a session
  revokeSession(token: string): void {
    this.sessions.delete(token)
    this.persistSessions()
  }

  // Get all active sessions
  getActiveSessions(): Session[] {
    const now = new Date()
    const active: Session[] = []

    // Clean up expired sessions
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(token)
      } else {
        active.push(session)
      }
    }

    this.persistSessions()
    return active
  }

  // Clear all sessions
  clearAllSessions(): void {
    this.sessions.clear()
    this.persistSessions()
  }

  // Generate a cryptographically secure token
  private generateSecureToken(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  // Persist sessions to localStorage
  private persistSessions(): void {
    try {
      const sessionsArray = Array.from(this.sessions.entries()).map(([token, session]) => ({
        token,
        ...session,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString()
      }))

      localStorage.setItem('noodles-external-sessions', JSON.stringify(sessionsArray))
    } catch (error) {
      console.error('Failed to persist sessions:', error)
    }
  }

  // Load sessions from localStorage
  loadSessions(): void {
    try {
      const stored = localStorage.getItem('noodles-external-sessions')
      if (!stored) return

      const sessionsArray = JSON.parse(stored)
      const now = new Date()

      for (const sessionData of sessionsArray) {
        const session: Session = {
          ...sessionData,
          createdAt: new Date(sessionData.createdAt),
          expiresAt: new Date(sessionData.expiresAt)
        }

        // Only load non-expired sessions
        if (session.expiresAt > now) {
          this.sessions.set(sessionData.token, session)
        }
      }
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }
}

export const sessionManager = SessionManager.getInstance()