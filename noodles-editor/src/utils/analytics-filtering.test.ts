import type posthog from 'posthog-js'
import type { BeforeSendFn, CaptureResult, PostHogConfig } from 'posthog-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock environment variables
vi.stubEnv('VITE_POSTHOG_API_KEY', 'test-api-key')

// Keeps the options passed to posthog.init (the analytics singleton only calls init once)
const posthogInit = vi.hoisted(() => ({ config: undefined as PostHogConfig | undefined }))

// Mock posthog before importing analytics
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn((_token: string, config: PostHogConfig) => {
      posthogInit.config = config
    }),
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

// posthog-js exception autocapture (capture_exceptions) installs its own window.onerror handler,
// so autocaptured errors never go through analytics.captureException(). They do go through the
// before_send hook passed to posthog.init, which is what these tests exercise.
describe('PostHog before_send exception filtering', () => {
  let beforeSend: BeforeSendFn | BeforeSendFn[] | undefined

  let analytics: Awaited<typeof import('./analytics')>['analytics']

  beforeEach(async () => {
    localStorage.clear()
    analytics = (await import('./analytics')).analytics
    analytics.initialize()
    beforeSend = posthogInit.config?.before_send
  })

  // Runs the hook(s) the way posthog-js does; with no hook, the event is sent unchanged
  function runBeforeSend(event: CaptureResult): CaptureResult | null {
    const hooks = beforeSend === undefined ? [] : [beforeSend].flat()
    let result: CaptureResult | null = event
    for (const hook of hooks) {
      result = hook(result)
      if (result === null) return null
    }
    return result
  }

  // Shape of the events that leaked to PostHog from window.onerror autocapture
  function autocapturedException(
    value: string,
    url = 'https://noodles.gl/app/examples/nyc-taxis'
  ): CaptureResult {
    return {
      uuid: 'test-uuid',
      event: '$exception',
      properties: {
        $current_url: url,
        $exception_list: [
          {
            type: 'Error',
            value,
            mechanism: { handled: false, synthetic: true, type: 'generic' },
          },
        ],
      },
    }
  }

  describe('benign error rule', () => {
    it('drops an autocaptured ResizeObserver loop exception', () => {
      const event = autocapturedException(
        'ResizeObserver loop completed with undelivered notifications.'
      )
      expect(runBeforeSend(event)).toBeNull()
    })

    it('drops a ResizeObserver exception reported via $exception_message', () => {
      const event: CaptureResult = {
        uuid: 'test-uuid',
        event: '$exception',
        properties: {
          $current_url: 'https://noodles.gl/app/projects/demo',
          $exception_message: 'ResizeObserver loop limit exceeded',
        },
      }
      expect(runBeforeSend(event)).toBeNull()
    })

    it('keeps real exceptions', () => {
      const event = autocapturedException("Cannot read properties of undefined (reading 'x')")
      expect(runBeforeSend(event)).toEqual(event)
    })

    it('leaves non-exception events alone', () => {
      const event: CaptureResult = {
        uuid: 'test-uuid',
        event: '$pageview',
        properties: { $current_url: 'https://noodles.gl/app/examples/nyc-taxis' },
      }
      expect(runBeforeSend(event)).toEqual(event)
    })
  })

  describe('error capture opt-out rule', () => {
    it('drops exceptions when error capture is turned off', () => {
      analytics.setErrorCaptureConsent(false)
      expect(runBeforeSend(autocapturedException('Real error'))).toBeNull()
    })

    it('leaves non-exception events alone when error capture is turned off', () => {
      analytics.setErrorCaptureConsent(false)
      const event: CaptureResult = {
        uuid: 'test-uuid',
        event: '$pageview',
        properties: { $current_url: 'https://noodles.gl/app/examples/nyc-taxis' },
      }
      expect(runBeforeSend(event)).toEqual(event)
    })

    it('sends exceptions when error capture is turned on', () => {
      analytics.setErrorCaptureConsent(true)
      const event = autocapturedException('Real error')
      expect(runBeforeSend(event)).toEqual(event)
    })

    it('applies a runtime toggle without re-initializing PostHog', () => {
      const event = autocapturedException('Real error')
      expect(runBeforeSend(event)).toEqual(event)

      analytics.setErrorCaptureConsent(false)
      expect(runBeforeSend(event)).toBeNull()

      analytics.setErrorCaptureConsent(true)
      expect(runBeforeSend(event)).toEqual(event)
      expect(posthogInit.config?.before_send).toBe(beforeSend)
    })
  })

  describe('local dev session rule', () => {
    it.each([
      'http://localhost:5173/app/projects/demo',
      'http://127.0.0.1:4173/app/examples/nyc-taxis',
      'http://[::1]:5173/app/',
    ])('drops exceptions from %s', url => {
      expect(runBeforeSend(autocapturedException('Real error', url))).toBeNull()
    })

    it('keeps exceptions from production hosts', () => {
      const event = autocapturedException('Real error', 'https://noodles.gl/app/projects/demo')
      expect(runBeforeSend(event)).toEqual(event)
    })

    it('keeps exceptions from hosts that only contain "localhost"', () => {
      const event = autocapturedException('Real error', 'https://localhost.example.com/app/')
      expect(runBeforeSend(event)).toEqual(event)
    })

    it('keeps non-exception events from dev sessions', () => {
      const event: CaptureResult = {
        uuid: 'test-uuid',
        event: '$pageview',
        properties: { $current_url: 'http://localhost:5173/app/' },
      }
      expect(runBeforeSend(event)).toEqual(event)
    })
  })
})
