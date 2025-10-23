import { useEffect, useState } from 'react'
import TimelineEditor from './timeline-editor'
import ExamplesPage from './examples-page'

function App() {
  const [route, setRoute] = useState(window.location.pathname)

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Route: /examples (examples list page)
  if (route === '/examples' || route === '/examples/') {
    return <ExamplesPage />
  }

  // All other routes render the timeline editor
  // (including /, /examples/:projectId, and legacy ?project= query strings)
  return <TimelineEditor />
}

export default App
