import { Component, type ReactNode } from 'react'
import { Redirect, Route, Router, Switch, useRoute, useSearchParams } from 'wouter'
import ExamplesPage from './examples-page'
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

const baseUrl = import.meta.env.BASE_URL.replace(/\/+$/, '')

function App() {
  console.log('App rendering, baseUrl:', baseUrl, 'location:', window.location.pathname)
  return (
    <Router base={baseUrl}>
      <Switch>
        {/* Project route - /examples/:projectId (most specific first) */}
        <Route path="/examples/:projectId">
          <TimelineEditor />
        </Route>

        {/* Examples list page */}
        <Route path="/examples">
          <ExamplesPage />
        </Route>

        {/* Catch-all for root path, 404s, and redirects */}
        <Route path="*">
          <FallbackRoute />
        </Route>
      </Switch>
      <AnalyticsErrorBoundary>
        <AnalyticsConsentBanner />
      </AnalyticsErrorBoundary>
    </Router>
  )
}

function FallbackRoute() {
  const [searchParams] = useSearchParams()
  const [match] = useRoute('/examples/:projectId')

  const redirect = searchParams.get('redirect')
  const projectParam = searchParams.get('project')

  console.log('FallbackRoute:', {
    path: window.location.pathname,
    search: window.location.search,
    redirect,
    projectParam,
    match,
  })

  // From Github / Cloudflare pages redirects (404.html)
  if (redirect) {
    if (redirect.startsWith('/') && !redirect.startsWith('//')) {
      // Valid redirect - process it
      const path = redirect.replace(/^\/app\//, '/') // Remove /app/ base if present
      console.log('Redirecting to:', path)
      return <Redirect to={path} />
    }
    // Invalid redirect - log warning and fall through to default navigation
    console.warn('Ignoring invalid redirect URL:', redirect)
  } else if (projectParam && !match) {
    // Redirect from ?project=name to /examples/name
    console.log('Redirecting to project:', projectParam)
    return <Redirect to={`/examples/${projectParam}`} />
  }

  // Default: navigate to /examples
  console.log('Default redirect to /examples')
  return <Redirect to="/examples" />
}

export default App
