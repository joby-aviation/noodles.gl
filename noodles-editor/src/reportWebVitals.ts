import type { ReportHandler } from 'web-vitals'
import { analytics } from './utils/analytics'

const reportWebVitals = (onPerfEntry?: ReportHandler) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
      onCLS(onPerfEntry)
      onINP(onPerfEntry)
      onFCP(onPerfEntry)
      onLCP(onPerfEntry)
      onTTFB(onPerfEntry)
    })
  }

  // Send web vitals to PostHog
  import('web-vitals').then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
    onCLS((metric) => {
      analytics.track('web_vital_measured', {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      })
    })
    onINP((metric) => {
      analytics.track('web_vital_measured', {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      })
    })
    onFCP((metric) => {
      analytics.track('web_vital_measured', {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      })
    })
    onLCP((metric) => {
      analytics.track('web_vital_measured', {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      })
    })
    onTTFB((metric) => {
      analytics.track('web_vital_measured', {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      })
    })
  })
}

export default reportWebVitals
