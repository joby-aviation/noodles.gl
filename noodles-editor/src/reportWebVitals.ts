import type { ReportHandler } from 'web-vitals'
import { analytics } from './utils/analytics'

const reportWebVitals = (onPerfEntry?: ReportHandler) => {
  // Consolidate web-vitals import to avoid duplicate module loading
  import('web-vitals')
    .then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
      // Defensive wrapper to catch web-vitals internal errors
      const safeMetricHandler = (handler: (metric: any) => void, metricName: string) => {
        return (metric: any) => {
          try {
            handler(metric)
          } catch (error) {
            console.error(`Web vitals ${metricName} measurement failed:`, error)
            // Make error visible to user
            if (typeof window !== 'undefined') {
              const errorMsg = `Performance tracking error (${metricName}): ${error instanceof Error ? error.message : 'Unknown error'}`
              // Dispatch a custom event that the app can listen to
              window.dispatchEvent(
                new CustomEvent('noodles:analytics-error', {
                  detail: { message: errorMsg, error },
                })
              )
            }
          }
        }
      }

      // Register optional performance entry handler
      if (onPerfEntry && onPerfEntry instanceof Function) {
        try {
          onCLS(safeMetricHandler(onPerfEntry, 'CLS'))
          onINP(safeMetricHandler(onPerfEntry, 'INP'))
          onFCP(safeMetricHandler(onPerfEntry, 'FCP'))
          onLCP(safeMetricHandler(onPerfEntry, 'LCP'))
          onTTFB(safeMetricHandler(onPerfEntry, 'TTFB'))
        } catch (error) {
          console.error('Failed to register web vitals handlers:', error)
        }
      }

      // Send web vitals to PostHog analytics
      onCLS(
        safeMetricHandler(metric => {
          analytics.track('web_vital_measured', {
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
          })
        }, 'CLS')
      )
      onINP(
        safeMetricHandler(metric => {
          analytics.track('web_vital_measured', {
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
          })
        }, 'INP')
      )
      onFCP(
        safeMetricHandler(metric => {
          analytics.track('web_vital_measured', {
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
          })
        }, 'FCP')
      )
      onLCP(
        safeMetricHandler(metric => {
          analytics.track('web_vital_measured', {
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
          })
        }, 'LCP')
      )
      onTTFB(
        safeMetricHandler(metric => {
          analytics.track('web_vital_measured', {
            name: metric.name,
            value: metric.value,
            rating: metric.rating,
          })
        }, 'TTFB')
      )
    })
    .catch(error => {
      console.error('Failed to load web-vitals library:', error)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('noodles:analytics-error', {
            detail: {
              message: 'Performance tracking unavailable',
              error,
            },
          })
        )
      }
    })
}

export default reportWebVitals
