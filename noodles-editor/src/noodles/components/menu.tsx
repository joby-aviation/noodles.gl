import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDownIcon, ChevronRightIcon, Cross2Icon, TrashIcon } from '@radix-ui/react-icons'
import * as Menubar from '@radix-ui/react-menubar'
import { useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { SettingsDialog } from '../../components/settings-dialog'
import { analytics } from '../../utils/analytics'
import { useActiveStorageType, useFileSystemStore } from '../filesystem-store'
import { save } from '../storage'
import { getOpStore } from '../store'
import { directoryHandleCache } from '../utils/directory-handle-cache'
import {
  NOODLES_VERSION,
  type NoodlesProjectJSON,
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
}

const MAX_RECENT_PROJECTS = 10

export function NoodlesMenubar({
  projectName,
  getTimelineJson,
  setProjectName,
  onSaveProject,
  onDownload,
  onNewProject,
  onImport,
  onOpen,
  undoRedo,
  showChatPanel,
  setShowChatPanel,
  startRender,
  takeScreenshot,
  isRendering,
}: {
  projectName?: string
  getTimelineJson: () => Record<string, unknown>
  setProjectName: Dispatch<SetStateAction<string | null>>
  onSaveProject: () => Promise<void>
  onDownload: () => Promise<void>
  onNewProject: () => Promise<void>
  onImport: () => Promise<void>
  onOpen: (projectName?: string) => Promise<void>
  undoRedo?: {
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    getState: () => { undoDescription?: string; redoDescription?: string }
  }
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
  startRender: () => Promise<void>
  takeScreenshot: () => Promise<void>
  isRendering: boolean
}) {
  const [recentlyOpened, setRecentlyOpened] = useState<RecentProject[]>([])
  const { toObject } = useReactFlow()
  const storageType = useActiveStorageType()
  const { setCurrentDirectory, setError } = useFileSystemStore()

  // "New" Menu Options - use callbacks from noodles.tsx
  const handleNewProject = onNewProject
  const handleImport = onImport

  // "Save" Menu Options
  const [saveProjectDialogOpen, setSaveProjectDialogOpen] = useState(false)
  const [replaceProjectDialogOpen, setReplaceProjectDialogOpen] = useState(false)

  const getNoodlesProjectJson = useCallback((): NoodlesProjectJSON => {
    const { nodes, edges, viewport } = toObject()
    const store = getOpStore()
    // sync op and node data
    const serializedNodes = serializeNodes(store, nodes, edges)
    const serializedEdges = serializeEdges(store, nodes, edges)
    const timeline = getTimelineJson()

    return {
      nodes: serializedNodes,
      edges: serializedEdges,
      viewport,
      timeline,
      version: NOODLES_VERSION,
    }
  }, [toObject, getTimelineJson])

  // Use save callback from noodles.tsx
  const handleSave = onSaveProject

  // This is a new project, so they need to name it before saving.
  const maybeSetProjectName = useCallback(
    async (name: string) => {
      setProjectName(name) // optimistically set project name
      // TODO: Check if project exists before saving (need projectExists in storage abstraction)
      if (await checkProjectExists(name)) {
        setReplaceProjectDialogOpen(true)
        return // return early if project is going to be replaced
      }
      const noodlesProjectJson = getNoodlesProjectJson()
      const result = await save(storageType, name, noodlesProjectJson)
      if (result.success) {
        // Update store with directory handle returned from save
        setCurrentDirectory(result.data.directoryHandle, name)
      } else {
        setError(result.error)
      }
    },
    [storageType, getNoodlesProjectJson, setProjectName, setCurrentDirectory, setError]
  )

  // When the project name is taken and the user choose to replace that existing project
  const onReplaceProject = useCallback(async () => {
    setReplaceProjectDialogOpen(false)
    const noodlesProjectJson = getNoodlesProjectJson()
    const result = await save(storageType, projectName!, noodlesProjectJson)
    if (result.success) {
      // Update store with directory handle returned from save
      setCurrentDirectory(result.data.directoryHandle, projectName!)
    } else {
      setError(result.error)
    }
  }, [projectName, storageType, getNoodlesProjectJson, setCurrentDirectory, setError])

  // User decided not to replace, revert back to an undecided name
  const onCancelReplaceProject = useCallback(() => {
    setReplaceProjectDialogOpen(false)
    setProjectName(null)
    setSaveProjectDialogOpen(true)
  }, [setProjectName])

  // Use download callback from noodles.tsx
  const handleExport = onDownload

  // "Open" Menu Options
  const [openProjectDialogOpen, setOpenProjectDialogOpen] = useState(false)

  // Settings Dialog
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)

  // Handle "Open..." button click based on storage type
  const onOpenMenuClick = useCallback(() => {
    if (storageType === 'fileSystemAccess') {
      // For File System Access API, directly show folder picker
      onOpen()
    } else {
      // For OPFS, show project list dialog
      setOpenProjectDialogOpen(true)
    }
  }, [storageType, onOpen])

  const updateRecentlyOpened = useCallback(() => {
    ;(async () => {
      const cachedHandles = await directoryHandleCache.getAllCachedHandles()

      // Convert to RecentProject format and limit to MAX_RECENT_PROJECTS
      const recentProjects: RecentProject[] = cachedHandles
        .slice(0, MAX_RECENT_PROJECTS)
        .map(entry => ({
          name: entry.projectName,
        }))

      setRecentlyOpened(recentProjects)
    })()
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
              <Menubar.Item className={s.menubarItem} onSelect={handleNewProject}>
                New Project <div className={s.menubarItemRightSlot}>⌘ N</div>
              </Menubar.Item>
              <Menubar.Item className={s.menubarItem} onSelect={handleImport}>
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
                        onSelect={() => onOpen(recent.name)}
                      >
                        {recent.name}
                      </Menubar.Item>
                    ))}
                  </Menubar.SubContent>
                </Menubar.Portal>
              </Menubar.Sub>
              <Menubar.Separator className={s.menubarSeparator} />
              <Menubar.Item className={s.menubarItem} onSelect={handleSave}>
                Save
              </Menubar.Item>
              {/* TODO: implement Save As... */}
              {/* <Menubar.Item className={s.menubarItem}>Save As...</Menubar.Item> */}
              <Menubar.Item className={s.menubarItem} onSelect={handleExport}>
                Download project
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

        {/* Render Menu */}
        <Menubar.Menu>
          <Menubar.Trigger className={s.menubarTrigger}>Render</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              className={s.menubarContent}
              align="start"
              sideOffset={5}
              alignOffset={-3}
            >
              <Menubar.Item
                className={s.menubarItem}
                onSelect={() => {
                  startRender()
                  analytics.track('render_started', { source: 'menu' })
                }}
                disabled={isRendering}
              >
                {isRendering ? 'Rendering...' : 'Start Render'}
              </Menubar.Item>
              <Menubar.Item
                className={s.menubarItem}
                onSelect={() => {
                  takeScreenshot()
                  analytics.track('screenshot_taken', { source: 'menu' })
                }}
              >
                Take Screenshot
              </Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        {/* Chat and Settings buttons on the right side */}
        <div className={s.menubarRightSlot}>
          {setShowChatPanel && (
            <button
              onClick={() => setShowChatPanel(!showChatPanel)}
              className={s.toolbarButton}
              title="Toggle Noodles AI Assistant"
            >
              💬 {showChatPanel ? 'Hide' : 'Assistant'}
            </button>
          )}
          <button
            onClick={() => setSettingsDialogOpen(true)}
            className={s.toolbarButton}
            title="Settings"
            style={{ marginLeft: setShowChatPanel ? '0.5rem' : '0' }}
          >
            ⚙️ Settings
          </button>
        </div>
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
        onSelectProject={onOpen}
      />
      <SettingsDialog open={settingsDialogOpen} setOpen={setSettingsDialogOpen} />
    </>
  )
}
