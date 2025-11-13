import { useEffect } from 'react'
import { Route, Switch, useLocation, useRoute, useSearchParams } from 'wouter'
import TimelineEditor from './timeline-editor'
import ExamplesPage from './examples-page'

function App() {
  const [location, navigate] = useLocation()
  const [searchParams] = useSearchParams()

  const [match] = useRoute('/project/:projectId')

  // Handle legacy ?project=name query string by redirecting to /examples/name
  useEffect(() => {
    const projectParam = searchParams.get('project')

    if (projectParam && !match) {
      // Redirect from ?project=name to /examples/name
      navigate(`/examples/${projectParam}`, { replace: true })
    }
  }, [location, searchParams, match, navigate])

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

      {/* Project route - /project/:projectId */}
      <Route path="/project/:projectId">
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
