import posthog from 'posthog-js'
import { debugAnalytics } from './debug'

const ANALYTICS_CONSENT_KEY = 'noodles-analytics-consent'
const ERROR_CAPTURE_CONSENT_KEY = 'noodles-error-capture-consent'
const POSTHOG_API_KEY = import.meta.env.VITE_POSTHOG_API_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID

// Declare gtag types for TypeScript
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

export interface AnalyticsConsent {
  enabled: boolean
  timestamp: string
  version: number
}

interface ErrorCaptureConsent {
  enabled: boolean
  timestamp: string
}

export class AnalyticsManager {
  private static instance: AnalyticsManager
  private posthogInitialized = false
  private gaInitialized = false

  static getInstance(): AnalyticsManager {
    if (!AnalyticsManager.instance) {
      AnalyticsManager.instance = new AnalyticsManager()
    }
    return AnalyticsManager.instance
  }

  initialize() {
    this.initializePostHog()
    this.initializeGoogleAnalytics()
  }

  private initializePostHog() {
    if (this.posthogInitialized || !POSTHOG_API_KEY) {
      return
    }

    try {
      const consent = this.getConsent()

      posthog.init(POSTHOG_API_KEY, {
        api_host: POSTHOG_HOST,
        opt_out_capturing_by_default: consent?.enabled === false, // only opt out if explicitly declined
        autocapture: false, // Privacy: manual events only
        disable_session_recording: true, // Privacy: no session recording
        capture_pageview: true, // Captures initial page load; route changes tracked manually
        capture_pageleave: true,
        capture_exceptions: true, // Capture unhandled exceptions
        loaded: posthog => {
          if (import.meta.env.DEV) {
            posthog.debug(false) // Set to true for verbose logging in dev
          }
        },
      })

      this.posthogInitialized = true
    } catch (error) {
      // Silently fail if PostHog is blocked by ad blockers
      debugAnalytics('PostHog initialization failed (likely blocked by ad blocker):', error)
      this.posthogInitialized = false
    }
  }

  private initializeGoogleAnalytics() {
    if (this.gaInitialized || !GA_MEASUREMENT_ID) {
      return
    }

    try {
      const consent = this.getConsent()

      // Load gtag.js script
      const script = document.createElement('script')
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
      document.head.appendChild(script)

      // Initialize dataLayer and gtag function
      window.dataLayer = window.dataLayer || []
      window.gtag = function gtag(...args: unknown[]) {
        window.dataLayer?.push(args)
      }
      window.gtag('js', new Date())

      // Configure with consent - default to denied until explicit consent
      window.gtag('consent', 'default', {
        analytics_storage: consent?.enabled === true ? 'granted' : 'denied',
      })

      window.gtag('config', GA_MEASUREMENT_ID, {
        send_page_view: true,
        anonymize_ip: true, // Privacy: anonymize IP addresses
      })

      this.gaInitialized = true
    } catch (error) {
      // Silently fail if Google Analytics is blocked
      debugAnalytics(
        'Google Analytics initialization failed (likely blocked by ad blocker):',
        error
      )
      this.gaInitialized = false
    }
  }

  getConsent(): AnalyticsConsent | null {
    try {
      const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY)
      return stored ? JSON.parse(stored) : null
    } catch (error) {
      debugAnalytics('Failed to read analytics consent:', error)
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

      // Update PostHog consent
      if (this.posthogInitialized) {
        if (enabled) {
          // Only fire a manual $pageview if the user was previously opted out —
          // for new visitors posthog.init already fired it via capture_pageview: true.
          const wasOptedOut = posthog.has_opted_out_capturing()
          posthog.opt_in_capturing()
          if (wasOptedOut) {
            posthog.capture('$pageview')
          }
        } else {
          posthog.opt_out_capturing()
        }
      }

      // Update Google Analytics consent
      if (this.gaInitialized && window.gtag) {
        window.gtag('consent', 'update', {
          analytics_storage: enabled ? 'granted' : 'denied',
        })
      }

      // Track the consent decision itself (this will only send if enabled)
      if (enabled) {
        this.track('analytics_consent_granted')
      } else {
        // For opt-out tracking, we send one final event to both providers before disabling
        // This helps us measure opt-out rates
        if (this.posthogInitialized) {
          try {
            posthog.capture('analytics_consent_denied')
          } catch (e) {
            debugAnalytics('Failed to track opt-out to PostHog:', e)
          }
        }
        if (this.gaInitialized && window.gtag) {
          try {
            window.gtag('event', 'analytics_consent_denied')
          } catch (e) {
            debugAnalytics('Failed to track opt-out to GA:', e)
          }
        }
      }
    } catch (error) {
      debugAnalytics('Failed to save analytics consent:', error)
    }
  }

  setErrorCaptureConsent(enabled: boolean) {
    const consent: ErrorCaptureConsent = {
      enabled,
      timestamp: new Date().toISOString(),
    }

    try {
      localStorage.setItem(ERROR_CAPTURE_CONSENT_KEY, JSON.stringify(consent))
    } catch (error) {
      debugAnalytics('Failed to save error capture consent:', error)
    }
  }

  getErrorCaptureEnabled(): boolean {
    try {
      const stored = localStorage.getItem(ERROR_CAPTURE_CONSENT_KEY)
      if (!stored) return true // Default to enabled
      const consent: ErrorCaptureConsent = JSON.parse(stored)
      return consent.enabled
    } catch {
      return true // Default to enabled on error
    }
  }

  hasSeenConsentPrompt(): boolean {
    return this.getConsent() !== null
  }

  track(event: string, properties?: Record<string, unknown>) {
    const consent = this.getConsent()
    if (consent?.enabled === false) {
      return
    }

    // Filter out sensitive properties
    const safeProperties = this.filterSensitiveData(properties || {})

    // Track to PostHog
    if (this.posthogInitialized) {
      try {
        posthog.capture(event, safeProperties)
      } catch (error) {
        debugAnalytics('PostHog tracking failed:', event, error)
      }
    }

    // Track to Google Analytics
    if (this.gaInitialized && window.gtag) {
      try {
        window.gtag('event', event, safeProperties)
      } catch (error) {
        debugAnalytics('Google Analytics tracking failed:', event, error)
      }
    }
  }

  identify(userId: string, properties?: Record<string, unknown>) {
    if (!this.initialized || this.getConsent()?.enabled === false) {
      return
    }

    try {
      const safeProperties = this.filterSensitiveData(properties || {})
      posthog.identify(userId, safeProperties)
    } catch (error) {
      debugAnalytics('Analytics identify failed:', error)
    }
  }

  reset() {
    if (!this.initialized) {
      return
    }

    try {
      posthog.reset()
    } catch (error) {
      debugAnalytics('Analytics reset failed:', error)
    }
  }

  capturePageview() {
    const consent = this.getConsent()
    if (consent?.enabled === false) {
      return
    }

    // PostHog pageview
    if (this.posthogInitialized) {
      try {
        posthog.capture('$pageview')
      } catch (error) {
        debugAnalytics('PostHog pageview capture failed:', error)
      }
    }

    // Google Analytics pageview
    if (this.gaInitialized && window.gtag) {
      try {
        window.gtag('event', 'page_view', {
          page_location: window.location.href,
          page_path: window.location.pathname,
        })
      } catch (error) {
        debugAnalytics('Google Analytics pageview capture failed:', error)
      }
    }
  }

  captureException(
    error: Error,
    properties?: Record<string, unknown> & { source?: string; componentStack?: string }
  ) {
    // Check if user has disabled error capture
    if (!this.getErrorCaptureEnabled()) {
      return
    }

    // PostHog exception capture
    if (this.posthogInitialized) {
      try {
        posthog.captureException(error, properties)
      } catch (err) {
        debugAnalytics('PostHog exception capture failed:', err)
      }
    }

    // Google Analytics exception capture
    if (this.gaInitialized && window.gtag) {
      try {
        // Filter sensitive data from exception properties
        const safeProperties = this.filterSensitiveData(properties || {})
        window.gtag('event', 'exception', {
          description: error.name, // Use error.name instead of error.message to avoid leaking file paths
          fatal: false,
          ...safeProperties,
        })
      } catch (err) {
        debugAnalytics('Google Analytics exception capture failed:', err)
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
    const hasAnyProvider = this.posthogInitialized || this.gaInitialized
    return hasAnyProvider && this.getConsent()?.enabled !== false
  }
}

// Export a singleton instance
export const analytics = AnalyticsManager.getInstance()
