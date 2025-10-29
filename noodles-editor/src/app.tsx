import { useEffect } from 'react'
import { Route, Switch, useLocation } from 'wouter'
import TimelineEditor from './timeline-editor'
import ExamplesPage from './examples-page'

function App() {
  const [location, navigate] = useLocation()

  // Handle legacy ?project=name query string by redirecting to /examples/name
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search)
    const projectParam = queryParams.get('project')

    if (projectParam && !location.startsWith('/examples/')) {
      // Redirect from ?project=name to /examples/name
      navigate(`/examples/${projectParam}`, { replace: true })
    }
  }, [location, navigate])

  return (
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
  )
}

export default App
