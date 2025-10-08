import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDownIcon, ChevronRightIcon, Cross2Icon, TrashIcon } from '@radix-ui/react-icons'
import * as Menubar from '@radix-ui/react-menubar'
import { useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import newProjectJSON from '../../../public/noodles/new.json'
import { useActiveStorageType, useFileSystemStore } from '../filesystem-store'
import { load, save } from '../storage'
import { useSlice } from '../store'
import { migrateProject } from '../utils/migrate-schema'
import {
  EMPTY_PROJECT,
  NODES_VERSION,
  type NoodlesProjectJSON,
  safeStringify,
  serializeEdges,
  serializeNodes,
} from '../utils/serialization'
import s from './menu.module.css'

const SaveProjectDialog = ({
  projectName,
  onAssignProjectName,
  open,
  setOpen,
}: {
  projectName: string | null
  onAssignProjectName: (name: string) => void
  open: boolean
  setOpen: (open: boolean) => void
}) => {
  const [tempProjectName, setTempProjectName] = useState(projectName)
  const [error, setError] = useState<string | null>(null)

  const onSave = useCallback(() => {
    if (!tempProjectName) {
      setError('Project name is required')
      return
    }
    // Theatre.js requirement
    if (tempProjectName.length < 3 || tempProjectName.length > 32) {
      setError('Project name must be between 3 and 32 characters')
      return
    }
    // For OPFS, needs to match filesystem restrictions
    // biome-ignore lint/suspicious/noControlCharactersInRegex: From https://github.com/sindresorhus/filename-reserved-regex
    if (/[<>:"/\\|?*\u0000-\u001F]/g.test(tempProjectName)) {
      const [matches] = tempProjectName.match(/([<>:"/\\|?*\u0000-\u001F])/g)

      setError(
        `Project name cannot contain special characters (e.g. <, >, :, ", /, \\, |, ?, *, \u0000-\u001F). Found: ${matches}`
      )
      return
    }
    setError(null)
    onAssignProjectName(tempProjectName)
    setOpen(false)
  }, [onAssignProjectName, tempProjectName, setOpen])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Save project</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Name your new project. Click save when you're done.
          </Dialog.Description>
          {error && <p className={s.dialogError}>{error}</p>}
          <fieldset className={s.dialogFieldset}>
            <label className={s.dialogLabel} htmlFor="project-name">
              Name
            </label>
            <input
              className={s.dialogInput}
              id="project-name"
              required
              value={tempProjectName || ''}
              onChange={e => setTempProjectName(e.target.value)}
            />
          </fieldset>
          <div className={s.dialogRightSlot}>
            <Dialog.Close asChild>
              <button type="button" className={s.dialogButton}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" className={cx(s.dialogButton, s.green)} onClick={onSave}>
              Save changes
            </button>
          </div>
          <Dialog.Close asChild>
            <button type="button" className={s.dialogIconButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const ReplaceProjectDialog = ({
  projectName,
  open,
  onReplace,
  onCancel,
}: {
  projectName: string | null
  onReplace: () => void
  open: boolean
  onCancel: () => void
}) => {
  return (
    <Dialog.Root open={open} onOpenChange={open => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Replace project</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            "{projectName}" already exists. Do you want to replace it?
          </Dialog.Description>
          <div className={s.dialogRightSlot}>
            <Dialog.Close asChild>
              <button type="button" className={s.dialogButton}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" className={cx(s.dialogButton, s.red)} onClick={onReplace}>
              Replace
            </button>
          </div>
          <Dialog.Close asChild>
            <button type="button" className={s.dialogIconButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const ProjectList = ({
  selectedProject,
  setSelectedProject,
}: {
  selectedProject?: string
  setSelectedProject: (project: string) => void
}) => {
  const [projects, setProjects] = useState<ProjectList>([])

  useEffect(() => {
    listProjects().then(projects => {
      // Sort most recently modified first. TODO: Reverse order option.
      const sorted = projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
      setProjects(sorted)
    })
  }, [])

  const onDeleteProject = (projectName: string) => {
    deleteProject(projectName)
    setProjects(projects.filter(project => project.name !== projectName))
  }

  return (
    <>
      {projects.map(project => (
        <tr
          className={s.projectRow}
          key={project.name}
          onClick={() => setSelectedProject(project.name)}
          style={{
            backgroundColor: selectedProject === project.name && 'var(--mauve-6)',
          }}
        >
          <td className={s.projectRowCell}>{project.name}</td>
          <td className={s.projectRowCell}>
            {project.lastModified.toLocaleString()}
            <TrashIcon onClick={() => onDeleteProject(project.name)} />
          </td>
        </tr>
      ))}
    </>
  )
}

const OpenProjectDialog = ({
  openDialog,
  setOpenDialog,
  onSelectProject,
}: {
  openDialog: boolean
  setOpenDialog: (open: boolean) => void
  onSelectProject: (name: string) => void
}) => {
  const [selectedProject, setSelectedProject] = useState<string>()

  return (
    <Dialog.Root open={openDialog} onOpenChange={setOpenDialog}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Open project</Dialog.Title>
          <div className={s.projectListWrapper}>
            <div className={s.projectList}>
              <table className={s.projectTable}>
                <thead>
                  <tr>
                    <th className={s.projectHeaderCell}>Project</th>
                    <th className={s.projectHeaderCell}>
                      Last Modified <ChevronDownIcon />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ProjectList
                    selectedProject={selectedProject}
                    setSelectedProject={setSelectedProject}
                  />
                </tbody>
              </table>
            </div>
          </div>
          <div className={s.dialogRightSlot}>
            <Dialog.Close asChild>
              <button type="button" className={s.dialogButton}>
                Cancel
              </button>
            </Dialog.Close>
            <Dialog.Close asChild onClick={() => onSelectProject(selectedProject!)}>
              <button
                type="button"
                className={cx(s.dialogButton, s.green)}
                disabled={!selectedProject}
              >
                Open
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Close asChild>
            <button type="button" className={s.dialogIconButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// OPFS Project File System
const PROJECTS = 'projects'
async function getProjectHandle(projectName: string, create = false) {
  const root = await navigator.storage.getDirectory()
  const projectDirectory = await root.getDirectoryHandle(PROJECTS, { create })
  return await projectDirectory.getFileHandle(projectName, { create })
}

// test if a project exists
async function checkProjectExists(projectName: string) {
  try {
    await getProjectHandle(projectName, false)
    return true
  } catch {
    return false
  }
}

async function deleteProject(projectName: string) {
  try {
    const fileHandle = await getProjectHandle(projectName, false)
    await fileHandle.remove()
    const recents = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (recents) {
      const updated = JSON.parse(recents).filter(
        (project: RecentProject) => project.name !== projectName
      )
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
    }
    console.log('Project deleted successfully:', `${PROJECTS}/${projectName}`)
  } catch (error) {
    console.error('Error deleting project:', error)
  }
}

function saveProjectLocally(projectName: string, projectJson: NoodlesProjectJSON) {
  const contents = safeStringify(projectJson)
  const blob = new Blob([contents], { type: 'application/json' })

  const a = document.createElement('a')
  a.download = `${projectName}.json`
  const url = URL.createObjectURL(blob)
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

type ProjectList = {
  name: string
  lastModified: Date
}[]

async function listProjects(): Promise<ProjectList> {
  const root = await navigator.storage.getDirectory()
  const projectDirectory = await root.getDirectoryHandle(PROJECTS, {
    create: true,
  })
  const files = []
  for await (const entry of projectDirectory.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      files.push({
        name: entry.name,
        lastModified: new Date(file.lastModified),
      })
    }
  }

  return files
}

// Open Recent...
type RecentProject = {
  name: string
  lastOpened: string
}

const RECENT_PROJECTS_KEY = 'recentProjects'
function getRecentProjects(): RecentProject[] {
  return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY)) || []
}

const MAX_RECENT_PROJECTS = 6
function addToRecentProjects(projectName: string) {
  const recentProjects = getRecentProjects()

  // Remove the project if it's already in the list
  const existingIndex = recentProjects.findIndex(
    (project: RecentProject) => project.name === projectName
  )
  if (existingIndex !== -1) {
    recentProjects.splice(existingIndex, 1)
  }

  // Add the new project with a timestamp
  recentProjects.unshift({
    name: projectName,
    lastOpened: new Date().toISOString(),
  })

  // Limit the list to the most recent projects
  if (recentProjects.length > MAX_RECENT_PROJECTS) {
    recentProjects.pop()
  }

  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recentProjects))
}

export function NodesMenubar({
  projectName,
  loadProjectFile,
  getTimelineJson,
  setProjectName,
  undoRedo,
}: {
  projectName?: string
  loadProjectFile: (project: NoodlesProjectJSON, projectName?: string) => void
  getTimelineJson: () => Record<string, unknown>
  setProjectName: Dispatch<SetStateAction<string | null>>
  undoRedo?: {
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    getState: () => { undoDescription?: string; redoDescription?: string }
  }
}) {
  const [recentlyOpened, setRecentlyOpened] = useState<RecentProject[]>([])
  const { toObject } = useReactFlow()
  const ops = useSlice(state => state.ops)
  const storageType = useActiveStorageType()
  const { setCurrentDirectory, setError } = useFileSystemStore()

  /* "New" Menu Options */
  const onNewProject = useCallback(() => {
    loadProjectFile(newProjectJSON)
  }, [loadProjectFile])

  const onImport = useCallback(async () => {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'JSON Files',
          accept: {
            'application/json': ['.json'],
          },
        },
      ],
      excludeAcceptAllOption: true,
      multiple: false,
    })
    const file = await fileHandle.getFile()
    const contents = await file.text()
    const parsed = JSON.parse(contents) as Partial<NoodlesProjectJSON>
    const project = await migrateProject({
      ...EMPTY_PROJECT,
      ...parsed,
    } as NoodlesProjectJSON)
    // "New project from local copy" means import a file into a blank project.
    // Resets the name to avoid conflict with an existing stored projects.
    loadProjectFile(project)
  }, [loadProjectFile])

  /* "Save" Menu Options */
  const [saveProjectDialogOpen, setSaveProjectDialogOpen] = useState(false)
  const [replaceProjectDialogOpen, setReplaceProjectDialogOpen] = useState(false)

  const getNodesProjectJson = useCallback((): NoodlesProjectJSON => {
    const { nodes, edges, viewport } = toObject()
    // sync op and node data
    const serializedNodes = serializeNodes(ops, nodes, edges)
    const serializedEdges = serializeEdges(ops, nodes, edges)
    const timeline = getTimelineJson()

    return {
      nodes: serializedNodes,
      edges: serializedEdges,
      viewport,
      timeline,
      version: NODES_VERSION,
    }
  }, [toObject, ops, getTimelineJson])

  // Basic save case. If the project is already named, save it.
  // Cache-aware: save will prompt user if project directory not cached for fileSystemAccess
  const onMenuSave = useCallback(async () => {
    if (!projectName) {
      setSaveProjectDialogOpen(true)
      return // return early if the project has no name
    }
    const nodesProjectJson = getNodesProjectJson()
    const result = await save(storageType, projectName, nodesProjectJson)
    if (result.success) {
      addToRecentProjects(projectName)
      // Update store with directory handle returned from save
      setCurrentDirectory(result.data.directoryHandle, projectName)
    } else {
      setError(result.error)
    }
  }, [projectName, storageType, getNodesProjectJson, setCurrentDirectory, setError])

  // This is a new project, so they need to name it before saving.
  const maybeSetProjectName = useCallback(
    async (name: string) => {
      setProjectName(name) // optimistically set project name
      // TODO: Check if project exists before saving (need projectExists in storage abstraction)
      if (await checkProjectExists(name)) {
        setReplaceProjectDialogOpen(true)
        return // return early if project is going to be replaced
      }
      const nodesProjectJson = getNodesProjectJson()
      const result = await save(storageType, name, nodesProjectJson)
      if (result.success) {
        addToRecentProjects(name)
        // Update store with directory handle returned from save
        setCurrentDirectory(result.data.directoryHandle, name)
      } else {
        setError(result.error)
      }
    },
    [storageType, getNodesProjectJson, setProjectName, setCurrentDirectory, setError]
  )

  // When the project name is taken and the user choose to replace that existing project
  const onReplaceProject = useCallback(async () => {
    setReplaceProjectDialogOpen(false)
    const nodesProjectJson = getNodesProjectJson()
    const result = await save(storageType, projectName!, nodesProjectJson)
    if (result.success) {
      addToRecentProjects(projectName!)
      // Update store with directory handle returned from save
      setCurrentDirectory(result.data.directoryHandle, projectName!)
    } else {
      setError(result.error)
    }
  }, [projectName, storageType, getNodesProjectJson, setCurrentDirectory, setError])

  // User decided not to replace, revert back to an undecided name
  const onCancelReplaceProject = useCallback(() => {
    setReplaceProjectDialogOpen(false)
    setProjectName(null)
    setSaveProjectDialogOpen(true)
  }, [setProjectName])

  const onExport = useCallback(async () => {
    const nodesProjectJson = getNodesProjectJson()
    saveProjectLocally(projectName || 'untitled', nodesProjectJson)
  }, [projectName, getNodesProjectJson])

  /* "Open" Menu Options */
  const [openProjectDialogOpen, setOpenProjectDialogOpen] = useState(false)

  // Load project by name (for OPFS projects from list)
  const onOpenProject = useCallback(
    (name: string) => {
      ;(async () => {
        // Cache-aware: load will prompt user if project directory not cached for fileSystemAccess
        const result = await load(storageType, name)
        if (result.success) {
          try {
            const project = await migrateProject(result.data.projectData)
            loadProjectFile(project, name)
            addToRecentProjects(name)
            // Update store with directory handle returned from load
            setCurrentDirectory(result.data.directoryHandle, name)
          } catch (error) {
            setError({
              type: 'unknown',
              message: 'Error migrating project',
              details: error instanceof Error ? error.message : 'Unknown error',
              originalError: error,
            })
          }
        } else {
          setError(result.error)
        }
      })()
    },
    [storageType, loadProjectFile, setCurrentDirectory, setError]
  )

  // Open File System Access API folder picker
  const onOpenFileSystemFolder = useCallback(async () => {
    try {
      // Dynamically import filesystem utilities to avoid circular dependencies
      const { directoryHandleCache } = await import('../utils/directory-handle-cache')
      const { selectDirectory } = await import('../utils/filesystem')
      const { load } = await import('../storage')

      // Show the native folder picker
      const projectDirectory = await selectDirectory()

      // Use the directory name as the project name
      const projectName = projectDirectory.name

      await directoryHandleCache.cacheHandle(projectName, projectDirectory, projectDirectory.name)

      const result = await load('fileSystemAccess', projectDirectory)

      if (result.success) {
        try {
          const project = await migrateProject(result.data.projectData)
          loadProjectFile(project, projectName)
          addToRecentProjects(projectName)
          // Update store with directory handle returned from load
          setCurrentDirectory(result.data.directoryHandle, projectName)
        } catch (error) {
          setError({
            type: 'unknown',
            message: 'Error migrating project',
            details: error instanceof Error ? error.message : 'Unknown error',
            originalError: error,
          })
        }
      } else {
        setError(result.error)
      }
    } catch (error) {
      // Handle abort error silently (user cancelled folder picker)
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      setError({
        type: 'unknown',
        message: 'Error opening folder',
        details: error instanceof Error ? error.message : 'Unknown error',
        originalError: error,
      })
    }
  }, [loadProjectFile, setCurrentDirectory, setError])

  // Handle "Open..." button click based on storage type
  const onOpenMenuClick = useCallback(() => {
    if (storageType === 'fileSystemAccess') {
      // For File System Access API, directly show folder picker
      onOpenFileSystemFolder()
    } else {
      // For OPFS, show project list dialog
      setOpenProjectDialogOpen(true)
    }
  }, [storageType, onOpenFileSystemFolder])

  const updateRecentlyOpened = useCallback(() => {
    setRecentlyOpened(getRecentProjects())
  }, [])

  return (
    <>
      <Menubar.Root className={s.menubarRoot}>
        <Menubar.Menu>
          <Menubar.Trigger className={s.menubarTrigger}>File</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              className={s.menubarContent}
              align="start"
              sideOffset={5}
              alignOffset={-3}
            >
              <Menubar.Item className={s.menubarItem} onSelect={onNewProject}>
                New Project <div className={s.menubarItemRightSlot}>⌘ N</div>
              </Menubar.Item>
              <Menubar.Item className={s.menubarItem} onSelect={onImport}>
                Import
              </Menubar.Item>
              <Menubar.Separator className={s.menubarSeparator} />
              <Menubar.Item className={s.menubarItem} onSelect={onOpenMenuClick}>
                Open... <div className={s.menubarItemRightSlot}>⌘ O</div>
              </Menubar.Item>
              <Menubar.Sub onOpenChange={updateRecentlyOpened}>
                <Menubar.SubTrigger className={s.menubarSubTrigger}>
                  Open Recent
                  <div className={s.menubarItemRightSlot}>
                    <ChevronRightIcon />
                  </div>
                </Menubar.SubTrigger>
                <Menubar.Portal>
                  <Menubar.SubContent className={s.menubarSubContent} alignOffset={-5}>
                    {recentlyOpened.map(recent => (
                      <Menubar.Item
                        key={recent.name}
                        className={s.menubarItem}
                        onSelect={() => onOpenProject(recent.name)}
                      >
                        {recent.name}
                      </Menubar.Item>
                    ))}
                  </Menubar.SubContent>
                </Menubar.Portal>
              </Menubar.Sub>
              <Menubar.Separator className={s.menubarSeparator} />
              <Menubar.Item className={s.menubarItem} onSelect={onMenuSave}>
                Save
              </Menubar.Item>
              {/* TODO: implement Save As... */}
              {/* <Menubar.Item className={s.menubarItem}>Save As...</Menubar.Item> */}
              <Menubar.Item className={s.menubarItem} onSelect={onExport}>
                Export
              </Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger className={s.menubarTrigger}>Edit</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              className={s.menubarContent}
              align="start"
              sideOffset={5}
              alignOffset={-3}
            >
              <Menubar.Item
                className={s.menubarItem}
                onSelect={undoRedo?.undo}
                disabled={!undoRedo?.canUndo()}
              >
                Undo{' '}
                {undoRedo?.getState().undoDescription
                  ? `"${undoRedo.getState().undoDescription}"`
                  : ''}
                <div className={s.menubarItemRightSlot}>⌘ Z</div>
              </Menubar.Item>
              <Menubar.Item
                className={s.menubarItem}
                onSelect={undoRedo?.redo}
                disabled={!undoRedo?.canRedo()}
              >
                Redo{' '}
                {undoRedo?.getState().redoDescription
                  ? `"${undoRedo.getState().redoDescription}"`
                  : ''}
                <div className={s.menubarItemRightSlot}>⌘ ⇧ Z</div>
              </Menubar.Item>
              <Menubar.Separator className={s.menubarSeparator} />
              <Menubar.Item className={s.menubarItem}>Cut</Menubar.Item>
              <Menubar.Item className={s.menubarItem}>Copy</Menubar.Item>
              <Menubar.Item className={s.menubarItem}>Paste</Menubar.Item>
              <Menubar.Item className={s.menubarItem}>Delete</Menubar.Item>
              <Menubar.Separator className={s.menubarSeparator} />
              <Menubar.Sub>
                <Menubar.SubTrigger className={s.menubarSubTrigger}>
                  Find
                  <div className={s.menubarItemRightSlot}>
                    <ChevronRightIcon />
                  </div>
                </Menubar.SubTrigger>
                <Menubar.Portal>
                  <Menubar.SubContent className={s.menubarSubContent} alignOffset={-5}>
                    <Menubar.Item className={s.menubarItem}>Find…</Menubar.Item>
                    <Menubar.Item className={s.menubarItem}>Find Next</Menubar.Item>
                    <Menubar.Item className={s.menubarItem}>Find Previous</Menubar.Item>
                  </Menubar.SubContent>
                </Menubar.Portal>
              </Menubar.Sub>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger className={s.menubarTrigger}>View</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              className={s.menubarContent}
              align="start"
              sideOffset={5}
              alignOffset={-3}
            >
              <Menubar.Item className={s.menubarItem}>Hide Nodes</Menubar.Item>
              <Menubar.Item className={s.menubarItem}>Hide TheatreJS</Menubar.Item>
              <Menubar.Separator className={s.menubarSeparator} />
              <Menubar.Item className={s.menubarItem}>Toggle Fullscreen</Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      </Menubar.Root>
      <SaveProjectDialog
        projectName={projectName ?? null}
        onAssignProjectName={maybeSetProjectName}
        open={saveProjectDialogOpen}
        setOpen={setSaveProjectDialogOpen}
      />
      <ReplaceProjectDialog
        projectName={projectName ?? null}
        open={replaceProjectDialogOpen}
        onReplace={onReplaceProject}
        onCancel={onCancelReplaceProject}
      />
      <OpenProjectDialog
        openDialog={openProjectDialogOpen}
        setOpenDialog={setOpenProjectDialogOpen}
        onSelectProject={onOpenProject}
      />
    </>
  )
}
