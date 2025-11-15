import { useEffect } from 'react'
import { Route, Router, Switch, useLocation, useRoute, useSearchParams } from 'wouter'
import TimelineEditor from './timeline-editor'
import ExamplesPage from './examples-page'

// Base path differs between development and production
// - Development (localhost): '/'
// - Production: '/app/'
const base = import.meta.env.DEV ? '/' : '/app/'

function App() {
  const [location, navigate] = useLocation()
  const [searchParams] = useSearchParams()

  const [match] = useRoute('/examples/:projectId')

  // Handle legacy ?project=name query string by redirecting to /examples/name
  useEffect(() => {
    const projectParam = searchParams.get('project')

    if (projectParam && !match) {
      // Redirect from ?project=name to /examples/name
      navigate(`/examples/${projectParam}`, { replace: true })
    }
  }, [location, searchParams, match, navigate])

  return (
    <Router base={base}>
      <Switch>
        {/* Examples list page */}
        <Route path="/examples">
          <ExamplesPage />
        </Route>

        {/* Project route - /examples/:projectId */}
        <Route path="/examples/:projectId">
          <TimelineEditor />
        </Route>

        {/* Root and all other routes - render timeline editor */}
        <Route path="*">
          <TimelineEditor />
        </Route>
      </Switch>
    </Router>
  )
}

export default App
