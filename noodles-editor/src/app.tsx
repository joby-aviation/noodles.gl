import { Route, Switch } from 'wouter'
import TimelineEditor from './timeline-editor'
import ExamplesPage from './examples-page'

function App() {
  return (
    <Switch>
      {/* Examples list page */}
      <Route path="/examples">
        <ExamplesPage />
      </Route>

      {/* Project route - /examples/:projectId */}
      <Route path="/examples/:projectId">
        {(params) => <TimelineEditor projectId={params.projectId} />}
      </Route>

      {/* Root and all other routes - render timeline editor */}
      <Route path="*">
        <TimelineEditor />
      </Route>
    </Switch>
  )
}

export default App
