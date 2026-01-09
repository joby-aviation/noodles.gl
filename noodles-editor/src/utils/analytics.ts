import posthog from 'posthog-js'

const ANALYTICS_CONSENT_KEY = 'noodles-analytics-consent'
const POSTHOG_API_KEY = import.meta.env.VITE_POSTHOG_API_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com'

export interface AnalyticsConsent {
  enabled: boolean
  timestamp: string
  version: number
}

export class AnalyticsManager {
  private static instance: AnalyticsManager
  private initialized = false

  static getInstance(): AnalyticsManager {
    if (!AnalyticsManager.instance) {
      AnalyticsManager.instance = new AnalyticsManager()
    }
    return AnalyticsManager.instance
  }

  initialize() {
    if (this.initialized || !POSTHOG_API_KEY) {
      return
    }

    try {
      const consent = this.getConsent()

      posthog.init(POSTHOG_API_KEY, {
        api_host: POSTHOG_HOST,
        opt_out_capturing_by_default: !consent?.enabled,
        autocapture: false, // Privacy: manual events only
        disable_session_recording: true, // Privacy: no session recording
        capture_pageview: false, // Manual tracking
        capture_pageleave: true,
        loaded: posthog => {
          if (import.meta.env.DEV) {
            posthog.debug(false) // Set to true for verbose logging in dev
          }
        },
      })

      this.initialized = true
    } catch (error) {
      // Silently fail if PostHog is blocked by ad blockers
      console.warn('Analytics initialization failed (likely blocked by ad blocker):', error)
      this.initialized = false
    }
  }

  getConsent(): AnalyticsConsent | null {
    try {
      const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY)
      return stored ? JSON.parse(stored) : null
    } catch (error) {
      console.error('Failed to read analytics consent:', error)
      return null
    }
  }

  setConsent(enabled: boolean) {
    const consent: AnalyticsConsent = {
      enabled,
      timestamp: new Date().toISOString(),
      version: 1,
    }

    try {
      localStorage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify(consent))

      if (this.initialized) {
        if (enabled) {
          posthog.opt_in_capturing()
        } else {
          posthog.opt_out_capturing()
        }
      }
    } catch (error) {
      console.warn('Failed to save analytics consent:', error)
    }
  }

  hasSeenConsentPrompt(): boolean {
    return this.getConsent() !== null
  }

  track(event: string, properties?: Record<string, unknown>) {
    if (!this.initialized || !this.getConsent()?.enabled) {
      return
    }

    try {
      // Filter out sensitive properties
      const safeProperties = this.filterSensitiveData(properties || {})
      posthog.capture(event, safeProperties)
    } catch (error) {
      // Silently fail if PostHog is blocked
      if (import.meta.env.DEV) {
        console.warn('Analytics tracking failed:', event, error)
      }
    }
  }

  identify(userId: string, properties?: Record<string, unknown>) {
    if (!this.initialized || !this.getConsent()?.enabled) {
      return
    }

    try {
      const safeProperties = this.filterSensitiveData(properties || {})
      posthog.identify(userId, safeProperties)
    } catch (error) {
      // Silently fail if PostHog is blocked
      if (import.meta.env.DEV) {
        console.warn('Analytics identify failed:', error)
      }
    }
  }

  reset() {
    if (!this.initialized) {
      return
    }

    try {
      posthog.reset()
    } catch (error) {
      // Silently fail if PostHog is blocked
      if (import.meta.env.DEV) {
        console.warn('Analytics reset failed:', error)
      }
    }
  }

  private filterSensitiveData(properties: Record<string, unknown>): Record<string, unknown> {
    const filtered = { ...properties }

    // Remove sensitive keys that might contain user data
    const sensitiveKeys = [
      'projectName',
      'fileName',
      'nodeId',
      'nodeData',
      'nodeValue',
      'query',
      'code',
      'apiKey',
      'prompt',
      'response',
      'message',
      'content',
      'data',
      'username',
      'email',
      'password',
      'token',
      'secret',
      'key',
      'url',
      'path',
      'filePath',
    ]

    sensitiveKeys.forEach(key => {
      if (key in filtered) {
        delete filtered[key]
      }
    })

    // Recursively filter nested objects
    Object.keys(filtered).forEach(key => {
      if (filtered[key] && typeof filtered[key] === 'object' && !Array.isArray(filtered[key])) {
        filtered[key] = this.filterSensitiveData(filtered[key] as Record<string, unknown>)
      }
    })

    return filtered
  }

  // Helper method to check if analytics is available and enabled
  isEnabled(): boolean {
    return this.initialized && !!this.getConsent()?.enabled
  }
}

// Export a singleton instance
export const analytics = AnalyticsManager.getInstance()
