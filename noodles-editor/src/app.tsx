import { Component, type ReactNode } from 'react'
import TimelineEditor from './timeline-editor'
import { AnalyticsConsentBanner } from './components/analytics-consent-banner'

// Error boundary to catch analytics failures
class AnalyticsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    // Silently catch analytics errors (e.g., if blocked by ad blockers)
    console.warn('Analytics component failed to load:', error)
  }

  render() {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

function App() {
  return (
    <>
      <TimelineEditor />
      <AnalyticsErrorBoundary>
        <AnalyticsConsentBanner />
      </AnalyticsErrorBoundary>
    </>
  )
}

export default App
