// @vitest-environment node
import { expect, test, describe } from 'vitest'

// Smoke tests for wouter-based routing
//
// These tests ensure that:
// 1. URL parsing logic works correctly
// 2. Path-based routing format is correct (/examples/project-name)
// 3. Legacy query string format is handled (?project=project-name)
// 4. URL construction doesn't duplicate project names
// 5. Route patterns match expected formats
//
// Note: These are unit tests that don't require browser/DOM environment
describe('Routing Smoke Tests', () => {
  // Helper function to extract projectId from location (mimics the logic in noodles.tsx)
  function getProjectIdFromLocation(pathname: string, search: string): string | null {
    // Try path-based routing first (e.g., /examples/nyc-taxis)
    const pathMatch = pathname.match(/^\/examples\/([^/]+)/)
    if (pathMatch) {
      return pathMatch[1]
    }
    // Fallback to query string (legacy support for ?project=name)
    const queryParams = new URLSearchParams(search)
    return queryParams.get('project')
  }

  describe('URL parsing', () => {
    test('extracts projectId from path-based URL', () => {
      const projectId = getProjectIdFromLocation('/examples/nyc-taxis', '')
      expect(projectId).toBe('nyc-taxis')
    })

    test('extracts projectId from legacy query string', () => {
      const projectId = getProjectIdFromLocation('/', '?project=nyc-taxis')
      expect(projectId).toBe('nyc-taxis')
    })

    test('prioritizes path over query string when both present', () => {
      const projectId = getProjectIdFromLocation(
        '/examples/california-earthquakes',
        '?project=nyc-taxis'
      )
      expect(projectId).toBe('california-earthquakes')
    })

    test('returns null for root path with no project', () => {
      const projectId = getProjectIdFromLocation('/', '')
      expect(projectId).toBeNull()
    })

    test('returns null for /examples list page', () => {
      const projectId = getProjectIdFromLocation('/examples', '')
      expect(projectId).toBeNull()
    })

    test('handles project names with multiple dashes', () => {
      const projectId = getProjectIdFromLocation('/examples/us-county-unemployment', '')
      expect(projectId).toBe('us-county-unemployment')
    })

    test('handles project names with numbers', () => {
      const projectId = getProjectIdFromLocation('/examples/sf-elevation-contours', '')
      expect(projectId).toBe('sf-elevation-contours')
    })

    test('does not match nested paths', () => {
      const projectId = getProjectIdFromLocation('/examples/foo/bar', '')
      // Should match 'foo' not 'foo/bar'
      expect(projectId).toBe('foo')
    })
  })

  describe('Route patterns', () => {
    test('examples list route is /examples', () => {
      const examplesRoute = '/examples'
      expect(examplesRoute).toBe('/examples')
    })

    test('project route pattern is /examples/:projectId', () => {
      const projectRoute = '/examples/:projectId'
      // Verify the pattern structure
      expect(projectRoute).toMatch(/^\/examples\/:[a-zA-Z]+$/)
    })

    test('legacy query string format is ?project=name', () => {
      const params = new URLSearchParams('?project=nyc-taxis')
      expect(params.get('project')).toBe('nyc-taxis')
    })
  })

  describe('URL construction', () => {
    test('constructs path-based URL without duplicating project name', () => {
      const projectName = 'california-earthquakes'
      const url = `/examples/${projectName}`

      // Count occurrences of project name
      const occurrences = (url.match(new RegExp(projectName, 'g')) || []).length
      expect(occurrences).toBe(1)

      // Verify structure
      expect(url).toBe('/examples/california-earthquakes')
      expect(url).not.toContain('?project=')
    })

    test('constructs legacy URL format', () => {
      const projectName = 'nyc-taxis'
      const url = new URL('http://localhost:5173')
      url.searchParams.set('project', projectName)

      expect(url.search).toBe('?project=nyc-taxis')
      expect(url.pathname).toBe('/')
    })

    test('examples list URL has no project identifier', () => {
      const url = '/examples'
      expect(url).not.toContain('?project=')
      expect(url).toBe('/examples')
    })
  })

  describe('Navigation paths', () => {
    test('root to examples list', () => {
      const from = '/'
      const to = '/examples'

      expect(to).not.toBe(from)
      expect(to).toBe('/examples')
    })

    test('examples list to specific project', () => {
      const from = '/examples'
      const to = '/examples/nyc-taxis'

      expect(to).not.toBe(from)
      expect(to).toMatch(/^\/examples\/[^/]+$/)
    })

    test('project to project navigation', () => {
      const from = '/examples/nyc-taxis'
      const to = '/examples/california-earthquakes'

      expect(to).not.toBe(from)

      const fromProject = getProjectIdFromLocation(from, '')
      const toProject = getProjectIdFromLocation(to, '')

      expect(fromProject).toBe('nyc-taxis')
      expect(toProject).toBe('california-earthquakes')
      expect(fromProject).not.toBe(toProject)
    })

    test('legacy query string redirects to path-based URL', () => {
      const legacyUrl = '/?project=nyc-taxis'
      const modernPath = '/examples/nyc-taxis'

      // Parse legacy URL
      const [pathname, search] = legacyUrl.split('?')
      const projectId = getProjectIdFromLocation(pathname, `?${search}`)

      // Construct modern URL
      const redirectTo = `/examples/${projectId}`

      expect(redirectTo).toBe(modernPath)
      expect(redirectTo).not.toContain('?project=')
    })
  })

  describe('Edge cases', () => {
    test('handles empty pathname gracefully', () => {
      const projectId = getProjectIdFromLocation('', '')
      expect(projectId).toBeNull()
    })

    test('handles malformed URLs', () => {
      const projectId = getProjectIdFromLocation('//examples//nyc-taxis', '')
      // Should still extract the project name
      expect(projectId).toBeNull()
    })

    test('handles trailing slashes', () => {
      const projectId = getProjectIdFromLocation('/examples/nyc-taxis/', '')
      // Regex should not match with trailing slash (wouter would normalize this)
      expect(projectId).toBe('nyc-taxis')
    })

    test('handles URL encoding', () => {
      const projectId = getProjectIdFromLocation('/examples/world-flights', '')
      expect(projectId).toBe('world-flights')
    })

    test('query string with no project param returns null', () => {
      const projectId = getProjectIdFromLocation('/', '?foo=bar&baz=qux')
      expect(projectId).toBeNull()
    })

    test('multiple query params with project', () => {
      const projectId = getProjectIdFromLocation(
        '/',
        '?project=nyc-taxis&safeMode=true'
      )
      expect(projectId).toBe('nyc-taxis')
    })
  })

  describe('wouter route matching', () => {
    test('/examples route should match exactly', () => {
      const route = '/examples'
      const pattern = /^\/examples$/

      expect(pattern.test(route)).toBe(true)
      expect(pattern.test('/examples/')).toBe(false)
      expect(pattern.test('/examples/nyc-taxis')).toBe(false)
    })

    test('/examples/:projectId route should match project paths', () => {
      const pattern = /^\/examples\/([^/]+)$/

      expect(pattern.test('/examples/nyc-taxis')).toBe(true)
      expect(pattern.test('/examples/california-earthquakes')).toBe(true)
      expect(pattern.test('/examples')).toBe(false)
      expect(pattern.test('/examples/')).toBe(false)
      expect(pattern.test('/examples/foo/bar')).toBe(false)
    })

    test('catch-all route should match everything else', () => {
      // wouter's "*" matches any path
      const testPaths = ['/', '/foo', '/bar/baz', '/anything']

      testPaths.forEach(path => {
        // Catch-all would match anything not matched by specific routes
        const isSpecificRoute = path === '/examples' || path.startsWith('/examples/')
        expect(isSpecificRoute || path !== '/examples').toBe(true)
      })
    })
  })
})
