import { useEffect } from 'react'
import { Route, Router, Switch, useLocation, useRoute, useSearchParams } from 'wouter'
import ExamplesPage from './examples-page'
import TimelineEditor from './timeline-editor'

const baseUrl = import.meta.env.BASE_URL.replace(/\/+$/, '')

function App() {
  return (
    <Router base={baseUrl}>
      <Switch>
        {/* Examples list page */}
        <Route path="/examples">
          <ExamplesPage />
        </Route>

        {/* Project route - /examples/:projectId */}
        <Route path="/examples/:projectId">
          <TimelineEditor />
        </Route>

        <Route path="*">
          <FallbackRoute />
        </Route>
      </Switch>
    </Router>
  )
}

function FallbackRoute() {
  const [, navigate] = useLocation()
  const [searchParams] = useSearchParams()
  const [match] = useRoute('/examples/:projectId')

  // Handle legacy ?project=name query string by redirecting to /examples/name
  useEffect(() => {
    const redirect = searchParams.get('redirect')
    const projectParam = searchParams.get('project')

    // From Github / Cloudflare pages redirects (404.html)
    if (redirect) {
      if (!redirect.startsWith('/') || redirect.startsWith('//')) {
        console.warn('Ignoring invalid redirect URL:', redirect)
        return
      }
      const path = redirect.replace(/^\/app\//, '/') // Remove /app/ base if present
      navigate(path, { replace: true })
      return
    }

    if (projectParam && !match) {
      // Redirect from ?project=name to /examples/name
      navigate(`/examples/${projectParam}`, { replace: true })
      return
    }

    navigate('/examples', { replace: true })
  }, [searchParams, match, navigate])
  return <h1>404 - Not Found</h1>
}

export default App
