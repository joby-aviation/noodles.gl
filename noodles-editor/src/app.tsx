import { Component, lazy, type ReactNode, Suspense, useEffect, useRef } from 'react'
import { Redirect, Route, Router, Switch, useLocation, useRoute, useSearchParams } from 'wouter'
import { AnalyticsConsentBanner } from './components/analytics-consent-banner'
import { type ModalView, QuickStartModal } from './components/quick-start-modal'
import { externalControl } from './noodles/globals'
import { useUIStore } from './noodles/store'
import TimelineEditor from './timeline-editor'
import { analytics } from './utils/analytics'
import { debugApp } from './utils/debug'

const ExternalControlProvider = lazy(() =>
  import('./external-control').then(m => ({ default: m.ExternalControlProvider }))
)

const WebMCPProvider = lazy(() => import('./webmcp').then(m => ({ default: m.WebMCPProvider })))

// Error boundary to catch analytics failures
class AnalyticsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    // Silently catch analytics errors (e.g., if blocked by ad blockers)
    debugApp('Analytics component failed to load:', error)
  }

  render() {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

// Fires $pageview on each route change. Skips first render only when the user already had consent
// at mount time — in that case PostHog's capture_pageview:true init already fired the event.
// First-time visitors who consent on the landing page are covered by setConsent's capturePageview call.
function PageviewTracker() {
  const [location] = useLocation()
  // Snapshot at mount: was PostHog already tracking when this component rendered?
  const hadConsentAtMount = useRef(analytics.isEnabled())
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      if (hadConsentAtMount.current) {
        return // PostHog init already captured this pageview
      }
    }
    analytics.capturePageview()
  }, [location])
  return null
}

const baseUrl = import.meta.env.BASE_URL.replace(/\/+$/, '')

function App() {
  debugApp('App rendering, baseUrl:', baseUrl, 'location:', window.location.pathname)

  // Check if external control should be enabled based on URL params
  const urlParams = new URLSearchParams(window.location.search)
  const externalControlDebug = urlParams.get('externalControlDebug') === 'true'

  return (
    <Router base={baseUrl}>
      <PageviewTracker />
      {/* External control providers - only enabled when requested via URL params.
          WebMCPProvider registers tools on navigator.modelContext (primary path);
          ExternalControlProvider is the legacy WebSocket bridge. */}
      {externalControl && (
        <Suspense fallback={null}>
          <WebMCPProvider />
          <ExternalControlProvider
            autoConnect={false}
            debug={externalControlDebug}
            onStatusChange={connected => {
              debugApp('[ExternalControl] Status:', connected ? 'Connected' : 'Disconnected')
            }}
            onError={error => {
              debugApp('[ExternalControl] Error:', error)
            }}
          />
        </Suspense>
      )}
      <Switch>
        {/* Project routes - /examples/:projectId, /projects/:projectId */}
        <Route path="/examples/:projectId">
          <TimelineEditor />
        </Route>
        <Route path="/projects/:projectId">
          <TimelineEditor />
        </Route>

        {/* List pages show modal with appropriate view */}
        <Route path="/examples">
          <QuickStartModalRoute initialView="examples" />
        </Route>
        <Route path="/projects">
          <QuickStartModalRoute initialView="projects" />
        </Route>

        {/* Root path - show modal with home view */}
        <Route path="/">
          <QuickStartModalRoute initialView="home" />
        </Route>

        {/* Catch-all for 404s and redirects */}
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

// Component to render QuickStartModal for /projects, /examples, and / routes
function QuickStartModalRoute({ initialView = 'home' }: { initialView?: ModalView }) {
  const [searchParams] = useSearchParams()
  const quickStartModalOpen = useUIStore(state => state.quickStartModalOpen)
  const setQuickStartModalOpen = useUIStore(state => state.setQuickStartModalOpen)

  // Handle redirect query param from Cloudflare Pages 404 handler
  const redirect = searchParams.get('redirect')
  const validRedirect = redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : null
  const redirectPath = validRedirect?.replace(/^\/app\//, '/') // Remove /app/ base if present

  // Ensure modal is open when navigating to these routes (only if not redirecting)
  useEffect(() => {
    if (!redirectPath) {
      setQuickStartModalOpen(true)
    }
  }, [setQuickStartModalOpen, redirectPath])

  if (redirectPath) {
    debugApp('QuickStartModalRoute: Redirecting to:', redirectPath)
    return <Redirect to={redirectPath} />
  }

  return (
    <QuickStartModal
      open={quickStartModalOpen}
      onOpenChange={setQuickStartModalOpen}
      initialView={initialView}
    />
  )
}

function FallbackRoute() {
  const [searchParams] = useSearchParams()
  const [match] = useRoute('/examples/:projectId')
  const quickStartModalOpen = useUIStore(state => state.quickStartModalOpen)
  const setQuickStartModalOpen = useUIStore(state => state.setQuickStartModalOpen)

  const redirect = searchParams.get('redirect')
  const projectParam = searchParams.get('project')

  debugApp('FallbackRoute:', {
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
      debugApp('Redirecting to:', path)
      return <Redirect to={path} />
    }
    // Invalid redirect - log warning and fall through to default navigation
    debugApp('Ignoring invalid redirect URL:', redirect)
  } else if (projectParam && !match) {
    // Redirect from ?project=name to /examples/name
    debugApp('Redirecting to project:', projectParam)
    return <Redirect to={`/examples/${projectParam}`} />
  }

  // Check if we're on the root path - show quick start modal
  const currentPath = window.location.pathname
  const isRootPath = currentPath === '/' || currentPath === baseUrl || currentPath === `${baseUrl}/`

  if (isRootPath && quickStartModalOpen) {
    return <QuickStartModal open={quickStartModalOpen} onOpenChange={setQuickStartModalOpen} />
  }

  // Default: redirect to root to show the modal
  debugApp('Default redirect to /')
  return <Redirect to="/" />
}

export default App
