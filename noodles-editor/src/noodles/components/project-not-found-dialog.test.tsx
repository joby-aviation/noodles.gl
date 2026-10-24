import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../utils/analytics'
import { load } from '../storage'
import { requestPermissionState } from '../utils/filesystem'
import { ProjectNotFoundDialog } from './project-not-found-dialog'

const navigate = vi.fn()
vi.mock('wouter', () => ({ useLocation: () => ['/projects/project_1', navigate] }))
vi.mock('../../utils/analytics', () => ({ analytics: { track: vi.fn() } }))
vi.mock('../storage', () => ({
  load: vi.fn(),
  openFailureReason: (type: string) => type.replace(/-/g, '_'),
}))
vi.mock('../utils/filesystem', () => ({
  checkFileSystemSupport: () => ({ fileSystemAccess: true, opfs: true }),
  requestPermissionState: vi.fn(),
  selectDirectory: vi.fn(),
}))
vi.mock('../utils/migrate-schema', () => ({
  migrateProject: vi.fn(data => Promise.resolve(data)),
}))

const handle = { kind: 'directory', name: 'project_1' } as FileSystemDirectoryHandle
const projectData = { version: 1, nodes: [], edges: [] }

function renderDialog(reason: 'not-found' | 'permission-prompt' | 'permission-denied') {
  const props = {
    projectName: 'project_1',
    open: true,
    reason,
    directoryHandle: handle,
    onProjectLoaded: vi.fn(),
    onNewProject: vi.fn(),
    onImport: vi.fn(),
    onClose: vi.fn(),
  }
  render(<ProjectNotFoundDialog {...props} />)
  return props
}

// Let the click handler's promises settle
async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync()
  })
}

describe('ProjectNotFoundDialog', () => {
  beforeEach(() => {
    vi.mocked(load).mockReset()
    vi.mocked(requestPermissionState).mockReset()
    vi.mocked(analytics.track).mockReset()
    navigate.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('asks for access with a button when the browser reset the permission', async () => {
    vi.mocked(requestPermissionState).mockResolvedValue('granted')
    vi.mocked(load).mockResolvedValue({
      success: true,
      data: {
        directoryHandle: handle,
        projectFileHandle: {} as FileSystemFileHandle,
        name: 'project_1',
        projectData,
      },
    } as Awaited<ReturnType<typeof load>>)
    const props = renderDialog('permission-prompt')

    expect(screen.getByText('Allow access to your project folder')).toBeDefined()
    // Nothing is asked until the click, which is the gesture the browser needs
    expect(requestPermissionState).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Allow access to project_1' }))
    await flush()

    expect(requestPermissionState).toHaveBeenCalledWith(handle, 'readwrite')
    expect(load).toHaveBeenCalledWith('fileSystemAccess', 'project_1')
    expect(props.onProjectLoaded).toHaveBeenCalledWith(projectData, 'project_1', undefined)
    expect(props.onClose).toHaveBeenCalled()
    expect(analytics.track).toHaveBeenCalledWith('project_permission_granted', {
      source: 'allow_button',
    })
    expect(analytics.track).toHaveBeenCalledWith('project_opened', {
      storageType: 'fileSystemAccess',
      source: 'allow_button',
    })
  })

  it('offers to choose the folder when access is not allowed', async () => {
    vi.mocked(requestPermissionState).mockResolvedValue('denied')
    const props = renderDialog('permission-prompt')

    fireEvent.click(screen.getByRole('button', { name: 'Allow access to project_1' }))
    await flush()

    expect(load).not.toHaveBeenCalled()
    expect(props.onProjectLoaded).not.toHaveBeenCalled()
    expect(screen.getByText("Can't open the project folder")).toBeDefined()
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDefined()
    expect(analytics.track).toHaveBeenCalledWith('project_permission_denied', {
      source: 'allow_button',
      state: 'denied',
    })
  })

  it('goes back to the projects list', () => {
    const props = renderDialog('permission-denied')

    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }))

    expect(props.onClose).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/projects')
  })

  it('never sends the project or folder name', async () => {
    vi.mocked(requestPermissionState).mockResolvedValue('prompt')
    renderDialog('permission-prompt')

    fireEvent.click(screen.getByRole('button', { name: 'Allow access to project_1' }))
    await flush()

    const sent = JSON.stringify(vi.mocked(analytics.track).mock.calls)
    expect(sent).not.toContain('project_1')
  })

  it('keeps the not-found choices for a project that is not saved here', () => {
    renderDialog('not-found')

    expect(screen.getByText('Project not found')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Import project' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Create new project' })).toBeDefined()
  })
})
