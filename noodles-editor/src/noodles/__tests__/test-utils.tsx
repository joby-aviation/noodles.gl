// Test utilities for React component integration tests
//
// Note: These utilities are provided for future component testing needs.
// The current integration tests focus on graph transformation logic
// and don't require React component rendering.
import { getProject } from '@theatre/core'
import studio from '@theatre/studio'
import { ReactFlowProvider } from '@xyflow/react'
import { render, type RenderOptions } from '@testing-library/react'
import { type ReactElement, useEffect, useMemo } from 'react'
import { SheetProvider } from '../../utils/sheet-context'

// Counter to ensure unique project names for each test
let projectCounter = 0

// Track created projects to avoid recreating during cleanup
const createdProjects = new Map<string, { project: ReturnType<typeof getProject>; sheet: ReturnType<ReturnType<typeof getProject>['sheet']> }>()

// Create a unique Theatre.js project for testing
// Prevents conflicts when multiple tests run in parallel
export function createTestTheatreProject(name?: string) {
  const uniqueName = name || `test-project-${projectCounter++}`
  const project = getProject(uniqueName, {})
  const sheet = project.sheet('test-sheet')
  createdProjects.set(uniqueName, { project, sheet })
  return { project, sheet, uniqueName }
}

// Clean up a Theatre.js project after testing
export function cleanupTheatreProject(projectName: string, sheetId: string) {
  try {
    const cached = createdProjects.get(projectName)
    if (cached) {
      studio.transaction(api => {
        api.__experimental_forgetSheet(cached.sheet)
      })
      createdProjects.delete(projectName)
    }
  } catch (e) {
    // Project may not exist or cleanup already happened, that's fine
  }
}

// Wrapper that provides React Flow context for testing
export function ReactFlowTestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100vw', height: '100vh' }}>{children}</div>
    </ReactFlowProvider>
  )
}

// Wrapper that provides both Theatre.js and React Flow contexts
// Uses a unique project name for each wrapper instance to avoid conflicts
export function NoodlesTestWrapper({
  children,
  projectName,
  sheetId = 'test-sheet',
}: {
  children: React.ReactNode
  projectName?: string
  sheetId?: string
}) {
  const uniqueProjectName = useMemo(() => projectName || `test-project-${projectCounter++}`, [projectName])

  const { project, sheet } = useMemo(() => {
    const project = getProject(uniqueProjectName, {})
    const sheet = project.sheet(sheetId)
    return { project, sheet }
  }, [uniqueProjectName, sheetId])

  useEffect(() => {
    return () => {
      cleanupTheatreProject(uniqueProjectName, sheetId)
    }
  }, [uniqueProjectName, sheetId])

  return (
    <ReactFlowProvider>
      <SheetProvider value={sheet}>
        <div style={{ width: '100vw', height: '100vh' }}>{children}</div>
      </SheetProvider>
    </ReactFlowProvider>
  )
}

// Render with React Flow provider
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, {
    wrapper: ReactFlowTestWrapper,
    ...options,
  })
}

// Render with both Theatre.js and React Flow providers
export function renderWithNoodlesProviders(
  ui: ReactElement,
  {
    projectName,
    sheetId = 'test-sheet',
    ...options
  }: Omit<RenderOptions, 'wrapper'> & { projectName?: string; sheetId?: string } = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <NoodlesTestWrapper projectName={projectName} sheetId={sheetId}>
        {children}
      </NoodlesTestWrapper>
    ),
    ...options,
  })
}
