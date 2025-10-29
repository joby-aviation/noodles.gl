import { expect, test, describe, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import App from './app'

// Integration smoke tests for wouter-based routing
//
// These tests actually render the app and verify:
// 1. Routes render the correct components
// 2. Navigation between routes works
// 3. URL state is managed correctly
// 4. Legacy query strings redirect properly
// 5. Project loading from URLs works
describe('Routing Integration Tests', () => {
  beforeEach(() => {
    // Reset location before each test
    window.history.replaceState({}, '', '/')
  })

  test('root path renders timeline editor with default project', async () => {
    render(<App />)

    // Should render the editor, not the examples page
    await waitFor(() => {
      // Examples page has a heading with "Examples"
      const examplesHeading = screen.queryByRole('heading', { name: /^examples$/i })
      expect(examplesHeading).toBeNull()

      // Timeline editor should have mounted
      const root = document.getElementById('root')
      expect(root?.children.length).toBeGreaterThan(0)
    }, { timeout: 5000 })
  })

  test('/examples shows the examples page with project cards', async () => {
    window.history.pushState({}, '', '/examples')
    render(<App />)

    // Wait for Examples heading
    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: /examples/i })
      expect(heading).toBeTruthy()
    }, { timeout: 3000 })

    // Check for description
    expect(screen.getByText(/explore example projects/i)).toBeTruthy()

    // Check that example cards render
    await waitFor(() => {
      const cards = document.querySelectorAll('a[href^="/examples/"]')
      expect(cards.length).toBeGreaterThan(0)
    }, { timeout: 3000 })
  })

  test('/examples/:projectId loads the timeline editor', async () => {
    window.history.pushState({}, '', '/examples/nyc-taxis')
    render(<App />)

    // Should NOT show examples page
    await waitFor(() => {
      const examplesHeading = screen.queryByRole('heading', { name: /^examples$/i })
      expect(examplesHeading).toBeNull()
    }, { timeout: 3000 })

    // URL should stay at /examples/nyc-taxis
    expect(window.location.pathname).toBe('/examples/nyc-taxis')

    // Should NOT add ?project= to URL
    expect(window.location.search).toBe('')
  })

  test('legacy ?project=name redirects to /examples/name', async () => {
    window.history.pushState({}, '', '/?project=california-earthquakes')
    render(<App />)

    // Should redirect to path-based URL
    await waitFor(() => {
      expect(window.location.pathname).toBe('/examples/california-earthquakes')
      expect(window.location.search).toBe('')
    }, { timeout: 3000 })
  })

  test('clicking an example card navigates to that project', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/examples')
    render(<App />)

    // Wait for examples to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /examples/i })).toBeTruthy()
    }, { timeout: 3000 })

    // Find first example link
    const exampleLinks = document.querySelectorAll('a[href^="/examples/"]')
    expect(exampleLinks.length).toBeGreaterThan(0)

    const firstLink = exampleLinks[0] as HTMLAnchorElement
    const expectedPath = firstLink.getAttribute('href')

    // Click it
    await user.click(firstLink)

    // Should navigate to that project
    await waitFor(() => {
      expect(window.location.pathname).toBe(expectedPath)
    }, { timeout: 3000 })

    // Examples page should be gone
    expect(screen.queryByRole('heading', { name: /^examples$/i })).toBeNull()
  })

  test('navigating back and forth preserves routing state', async () => {
    window.history.pushState({}, '', '/examples')
    const { unmount } = render(<App />)

    // Start on examples page
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /examples/i })).toBeTruthy()
    }, { timeout: 3000 })

    // Navigate to a project
    window.history.pushState({}, '', '/examples/nyc-taxis')
    unmount()
    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/examples/nyc-taxis')
      expect(screen.queryByRole('heading', { name: /^examples$/i })).toBeNull()
    }, { timeout: 3000 })

    // Go back
    window.history.back()
    unmount()
    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/examples')
      expect(screen.getByRole('heading', { name: /examples/i })).toBeTruthy()
    }, { timeout: 3000 })
  })

  test('URL does not contain duplicate project names', async () => {
    window.history.pushState({}, '', '/examples/world-flights')
    render(<App />)

    await waitFor(() => {
      const url = window.location.href
      const projectName = 'world-flights'

      // Count occurrences of project name in full URL
      const occurrences = (url.match(new RegExp(projectName, 'g')) || []).length

      // Should appear exactly once
      expect(occurrences).toBe(1)

      // Verify it's in the path, not in query params
      expect(window.location.pathname).toContain(projectName)
      expect(window.location.search).not.toContain(projectName)
    }, { timeout: 3000 })
  })

  test('switching between projects updates the URL correctly', async () => {
    const projects = ['nyc-taxis', 'california-earthquakes', 'world-flights']
    const { unmount } = render(<App />)

    for (const projectName of projects) {
      window.history.pushState({}, '', `/examples/${projectName}`)
      unmount()
      render(<App />)

      await waitFor(() => {
        expect(window.location.pathname).toBe(`/examples/${projectName}`)
        expect(window.location.search).toBe('')

        // Should not show examples list
        expect(screen.queryByRole('heading', { name: /^examples$/i })).toBeNull()
      }, { timeout: 3000 })

      unmount()
    }
  })

  test('examples list shows multiple project cards', async () => {
    window.history.pushState({}, '', '/examples')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /examples/i })).toBeTruthy()
    }, { timeout: 3000 })

    // Should have multiple example links
    const exampleLinks = document.querySelectorAll('a[href^="/examples/"]')
    expect(exampleLinks.length).toBeGreaterThan(5) // We have 13+ examples

    // Check that links have correct format
    exampleLinks.forEach((link) => {
      const href = link.getAttribute('href')
      expect(href).toMatch(/^\/examples\/[a-z0-9-]+$/)
    })
  })

  test('invalid project path still renders timeline editor', async () => {
    // This should attempt to load a non-existent project
    window.history.pushState({}, '', '/examples/nonexistent-project-12345')
    render(<App />)

    // Should render timeline editor (which will handle the not-found case)
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /^examples$/i })).toBeNull()
    }, { timeout: 3000 })

    // URL should stay the same
    expect(window.location.pathname).toBe('/examples/nonexistent-project-12345')
  })

  test('examples page has proper grid layout', async () => {
    window.history.pushState({}, '', '/examples')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /examples/i })).toBeTruthy()
    }, { timeout: 3000 })

    // Check for grid container
    const grid = document.querySelector('[class*="examplesGrid"]')
    expect(grid).toBeTruthy()

    // Check it has multiple cards
    const cards = grid?.querySelectorAll('a')
    expect(cards?.length).toBeGreaterThan(0)
  })
})
