import { beforeEach, describe, expect, it, vi } from 'vitest'
import type posthog from 'posthog-js'

// Mock posthog before importing analytics
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
  },
}))

describe('Analytics error filtering', () => {
  let analytics: any
  let mockPosthog: typeof posthog

  beforeEach(async () => {
    vi.clearAllMocks()

    // Clear localStorage
    localStorage.clear()

    // Re-import analytics to get fresh instance
    const analyticsModule = await import('./analytics')
    analytics = analyticsModule.analytics
    const posthogModule = await import('posthog-js')
    mockPosthog = posthogModule.default

    // Initialize analytics
    analytics.initialize()
  })

  describe('ResizeObserver error filtering', () => {
    it('should filter ResizeObserver loop errors', () => {
      const resizeError = new Error('ResizeObserver loop completed with undelivered notifications')

      analytics.captureException(resizeError, { source: 'test' })

      // PostHog should not be called for ResizeObserver errors
      expect(mockPosthog.captureException).not.toHaveBeenCalled()
    })

    it('should filter ResizeObserver errors with partial message match', () => {
      const resizeError = new Error('Something went wrong: ResizeObserver loop limit exceeded')

      analytics.captureException(resizeError, { source: 'test' })

      expect(mockPosthog.captureException).not.toHaveBeenCalled()
    })

    it('should capture non-ResizeObserver errors normally', () => {
      const normalError = new Error('Actual error that should be tracked')

      analytics.captureException(normalError, { source: 'test' })

      // Should capture non-filtered errors
      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        normalError,
        expect.objectContaining({ source: 'test' })
      )
    })

    it('should capture TypeError exceptions', () => {
      const typeError = new TypeError('Cannot read property of undefined')

      analytics.captureException(typeError, { source: 'test' })

      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        typeError,
        expect.objectContaining({ source: 'test' })
      )
    })

    it('should capture ReferenceError exceptions', () => {
      const refError = new ReferenceError('Variable is not defined')

      analytics.captureException(refError, { source: 'test' })

      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        refError,
        expect.objectContaining({ source: 'test' })
      )
    })
  })

  describe('Error capture consent', () => {
    it('should respect error capture disabled setting', () => {
      analytics.setErrorCaptureConsent(false)

      const error = new Error('Test error')
      analytics.captureException(error)

      expect(mockPosthog.captureException).not.toHaveBeenCalled()
    })

    it('should capture errors when consent is enabled', () => {
      analytics.setErrorCaptureConsent(true)

      const error = new Error('Test error')
      analytics.captureException(error, { source: 'test' })

      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ source: 'test' })
      )
    })

    it('should default to enabled when no consent stored', () => {
      // Clear any stored consent
      localStorage.removeItem('noodles-error-capture-consent')

      const error = new Error('Test error')
      analytics.captureException(error, { source: 'test' })

      // Should capture by default
      expect(mockPosthog.captureException).toHaveBeenCalled()
    })
  })

  describe('Error properties filtering', () => {
    it('should include non-sensitive properties', () => {
      const error = new Error('Test error')
      analytics.captureException(error, {
        source: 'chart_op',
        chartType: 'bar',
        hasData: true,
      })

      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          source: 'chart_op',
          chartType: 'bar',
          hasData: true,
        })
      )
    })

    it('should include component stack when provided', () => {
      const error = new Error('React error')
      analytics.captureException(error, {
        source: 'react_error_boundary',
        componentStack: 'at Component (bundle.js:123)',
      })

      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          source: 'react_error_boundary',
          componentStack: 'at Component (bundle.js:123)',
        })
      )
    })
  })

  describe('Multiple error types', () => {
    it('should filter all ResizeObserver variants', () => {
      const errors = [
        new Error('ResizeObserver loop completed with undelivered notifications'),
        new Error('ResizeObserver loop limit exceeded'),
        new Error('Something ResizeObserver loop something'),
      ]

      errors.forEach(error => {
        analytics.captureException(error)
      })

      // None should be captured
      expect(mockPosthog.captureException).not.toHaveBeenCalled()
    })

    it('should capture all non-ResizeObserver errors', () => {
      const errors = [
        new Error('Normal error'),
        new TypeError('Type error'),
        new ReferenceError('Reference error'),
        new Error('Another error'),
      ]

      errors.forEach(error => {
        analytics.captureException(error, { source: 'test' })
      })

      // All should be captured
      expect(mockPosthog.captureException).toHaveBeenCalledTimes(4)
    })
  })
})
