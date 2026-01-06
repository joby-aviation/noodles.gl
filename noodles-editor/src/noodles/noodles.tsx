import type { AnyNodeJSON } from 'SKIP-@xyflow/react'
import * as deckWidgets from '@deck.gl/widgets'
import { getProject, type IProjectConfig } from '@theatre/core'
import studio from '@theatre/studio'
import type {
  Connection,
  DefaultEdgeOptions,
  FitViewOptions,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
} from '@xyflow/react'
import {
  Background,
  Controls,
  ReactFlow,
  type ReactFlowInstance,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import cx from 'classnames'
import type { LayerExtension } from 'deck.gl'
import * as deck from 'deck.gl'
import JSZip, { type JSZipObject } from 'jszip'
import { PrimeReactProvider } from 'primereact/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { ChatPanel } from '../ai-chat/chat-panel'
import { globalContextManager } from '../ai-chat/global-context-manager'
import { analytics } from '../utils/analytics'
import { getKeysForProject, getKeysStore } from './keys-store'
import newProjectJSON from './new.json'

// Get URLs for all example noodles.json files (lazy-loaded)
const exampleProjectUrls = import.meta.glob('../examples/**/noodles.json', {
  eager: true,
  query: '?url',
  import: 'default',
})

import { SheetProvider } from '../utils/sheet-context'
import type { Visualization } from '../visualizations'
import { BlockLibrary, type BlockLibraryRef } from './components/block-library'
import { categories, nodeTypeToDisplayName } from './components/categories'
import { CopyControls, type CopyControlsRef } from './components/copy-controls'
import { ErrorBoundary } from './components/error-boundary'
import { PropertyPanel } from './components/node-properties'
import { NodeTreeSidebar } from './components/node-tree-sidebar'
import { edgeComponents, nodeComponents } from './components/op-components'
import { UNSAVED_PROJECT_NAME } from './components/project-name-bar'
import { ProjectNotFoundDialog } from './components/project-not-found-dialog'
import { StorageErrorHandler } from './components/storage-error-handler'
import { UndoRedoHandler, type UndoRedoHandlerRef } from './components/UndoRedoHandler'
import { useActiveStorageType, useFileSystemStore } from './filesystem-store'
import { IS_PROD } from './globals'
import { useKeyboardShortcut } from './hooks/use-keyboard-shortcut'
import { useProjectModifications } from './hooks/use-project-modifications'
import type { IOperator, Operator, OutOp } from './operators'
import { extensionMap } from './operators'
import { load, save } from './storage'
import { getOpStore, useNestingStore } from './store'
import { bindOperatorToTheatre, cleanupRemovedOperators } from './theatre-bindings'
import { transformGraph } from './transform-graph'
import { directoryHandleCache } from './utils/directory-handle-cache'
import { requestPermission, selectDirectory, writeFileToDirectory } from './utils/filesystem'
import { edgeId, nodeId } from './utils/id-utils'
import { migrateProject } from './utils/migrate-schema'
import { getParentPath } from './utils/path-utils'
import { pick } from './utils/pick'
import {
  EMPTY_PROJECT,
  NOODLES_VERSION,
  type NoodlesProjectJSON,
  safeStringify,
  saveProjectLocally,
  serializeEdges,
  serializeNodes,
} from './utils/serialization'

/*
 * CSS Architecture:
 * - layers.css: Establishes CSS layers and imports vendor CSS into 'vendors' layer
 * - noodles.module.css: Component styles and critical unlayered overrides
 *
 * CSS layers ensure vendor styles have lowest priority, making our overrides
 * work reliably regardless of import order (prevents linting from breaking styles).
 */
import './layers.css'
import s from './noodles.module.css'

export type Edge<N1 extends Operator<IOperator>, N2 extends Operator<IOperator>> = {
  id: `${N1['id']}.${'par' | 'out'}.${keyof N1['outputs']}->${N2['id']}.${'par' | 'out'}.${keyof N2['inputs']}`
  source: N1['id']
  target: N2['id']
  sourceHandle: `${'par' | 'out'}.${keyof N1['outputs']}`
  targetHandle: `${'par' | 'out'}.${keyof N2['inputs']}`
}

const fitViewOptions: FitViewOptions = {
  padding: 0.2,
}

const defaultEdgeOptions: DefaultEdgeOptions = {
  animated: false,
}

// Offset to position new ViewerOps to the right of the source node when created via 'v' keypress
const VIEWER_OFFSET_X = 400

// TheatreJS is used by the Noodles framework to provide a timeline and keyframe animation for Op fields.
// Naturally, the Noodles framework will load a new theatre state when a Noodles project is loaded.
// TheatreJS doesn't support loading projects with the same ID more than once, so a new theatre project name is generated when a new Noodles project is loaded.
// Currently a UUID is used, but a more human-readable name could be generated instead as long as its unique to the page session.
//
// TheatreJS project names are not included in the Noodles project file.
// TheatreJS sheet names are included, so they should be the same for every project.
const THEATRE_SHEET_ID = 'Noodles'
function useTheatreJs(projectName?: string) {
  // Increment whenever a new theatre project is created to keep the project name unique *within theatre*.
  const _projectCounterRef = useRef(1)
  const name = `${projectName || UNSAVED_PROJECT_NAME}-${_projectCounterRef.current}`
  const config = {} as IProjectConfig
  const [theatreState, setTheatreState] = useState({ name, config })
  const [theatreReady, setTheatreReady] = useState(false)
  const theatreProject = useMemo(() => {
    const { name, config } = theatreState
    setTheatreReady(false)
    return getProject(name, config)
  }, [theatreState])
  const theatreSheet = useMemo(() => theatreProject.sheet(THEATRE_SHEET_ID), [theatreProject])
  useEffect(() => {
    theatreProject?.ready.then(() => setTheatreReady(true))
  }, [theatreProject])

  const setTheatreProject = useCallback(
    (theatreConfig: IProjectConfig, incomingProjectName?: string) => {
      // Theatre stores too much state if you don't reset it properly.
      // We need to detach special objects (render) before forgetting the sheet.

      // Detach the special Theatre objects that persist across the app
      theatreSheet.detachObject('render')

      // Then forget the sheet to clean up the Theatre.js UI
      studio.transaction(api => {
        try {
          api.__experimental_forgetSheet(theatreSheet)
        } catch (error) {
          console.warn('Error forgetting Theatre sheet:', error)
        }
      })

      // Increment the project counter to keep the project name unique
      _projectCounterRef.current += 1
      const newProjectName = `${incomingProjectName || UNSAVED_PROJECT_NAME}-${_projectCounterRef.current}`
      setTheatreState({ name: newProjectName, config: theatreConfig })
    },
    [theatreSheet]
  )

  const getTimelineJson = useCallback(() => {
    const timeline = studio.createContentOfSaveFile(theatreState.name)

    // Clear staticOverrides to prevent them from being saved, only preserve render
    // object since we're storing that state in Theatre
    const sheetsById = Object.fromEntries(
      Object.entries(
        timeline.sheetsById as Record<string, { staticOverrides?: { byObject?: unknown } }>
      ).map(([sheetId, sheet]) => [
        sheetId,
        {
          ...sheet,
          staticOverrides: {
            byObject: pick(sheet.staticOverrides?.byObject || {}, ['render']),
          },
        },
      ])
    )

    return { ...timeline, sheetsById }
  }, [theatreState.name])

  return {
    theatreReady,
    theatreProject,
    theatreSheet,
    setTheatreProject,
    getTimelineJson,
  }
}

// Not using the top-level sheet since a Noodles theatre sheet and project are dynamically created.
// Also, the top-level sheet is used for theatre-managed project files, whereas a Noodles project file is managed within this visType.

export function getNoodles(): Visualization {
  const [location, navigate] = useLocation()
  const params = useParams()

  // Get projectId from route params (/examples/:projectId or /projects/:projectId) - router is single source of truth
  const projectName = params.projectId

  // Detect if we're on /projects or /examples route to preserve it when navigating
  const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'

  const [showProjectNotFoundDialog, setShowProjectNotFoundDialog] = useState(false)
  const storageType = useActiveStorageType()
  const { setCurrentDirectory, setActiveStorageType, setError } = useFileSystemStore()
  const { theatreReady, theatreProject, theatreSheet, setTheatreProject, getTimelineJson } =
    useTheatreJs(projectName)
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<AnyNodeJSON>([])
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<ReactFlowEdge<unknown>>([])
  const [defaultViewport, setDefaultViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [showChatPanel, setShowChatPanel] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Wrap onNodesChange to track node selection and mark unsaved changes
  const onNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeBase>[0]) => {
      // Track selection changes
      const selectedChanges = changes.filter(change => change.type === 'select' && change.selected)
      if (selectedChanges.length > 0) {
        analytics.track('node_selected', { count: selectedChanges.length })
      }

      // Mark as unsaved if there are non-selection changes
      const hasNonSelectionChanges = changes.some(change => change.type !== 'select')
      if (hasNonSelectionChanges) {
        setHasUnsavedChanges(true)
      }

      onNodesChangeBase(changes)
    },
    [onNodesChangeBase]
  )

  // Wrap onEdgesChange to mark unsaved changes
  const onEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChangeBase>[0]) => {
      // Mark as unsaved if there are non-selection changes
      const hasNonSelectionChanges = changes.some(change => change.type !== 'select')
      if (hasNonSelectionChanges) {
        setHasUnsavedChanges(true)
      }

      onEdgesChangeBase(changes)
    },
    [onEdgesChangeBase]
  )

  // Update URL when project name changes (for when loading a project from file/storage)
  // This updates the router, which will trigger projectName to update via useMemo
  const setProjectName = useCallback(
    (nameOrUpdater: React.SetStateAction<string | null>) => {
      // Handle both direct values and updater functions
      const name =
        typeof nameOrUpdater === 'function' ? nameOrUpdater(projectName ?? null) : nameOrUpdater

      if (name) {
        navigate(`${routePrefix}/${name}`, { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    },
    [navigate, projectName, routePrefix]
  )

  // Eagerly start loading AI context bundles on app start
  useEffect(() => {
    globalContextManager.startLoading().catch(error => {
      console.warn('Failed to preload AI context:', error)
    })
  }, [])

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        // Modern browsers require returnValue to be set
        e.returnValue = ''
      }
    }

    document.title = projectName
      ? `Noodles.gl - ${projectName}${hasUnsavedChanges ? ' *' : ''}`
      : 'Noodles.gl'

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges, projectName])

  // `transformGraph` needs all nodes to build the opMap and resolve connections
  // Use useEffect instead of useMemo to avoid setState during render
  const [operators, setOperators] = useState<Operator<IOperator>[]>([])
  useEffect(() => {
    const ops = transformGraph({ nodes, edges })
    setOperators(ops)
  }, [nodes, edges])

  // Bind Theatre.js objects for all operators (outside ReactFlow rendering pipeline)
  // This ensures containers and all other operators can be keyframed in the timeline
  useEffect(() => {
    if (!theatreReady || !theatreSheet) return

    // Track cleanup functions for newly bound operators
    const newCleanupFns = new Map<string, () => void>()

    // Only bind operators that aren't already bound
    const store = getOpStore()
    for (const op of operators) {
      if (!store.hasSheetObject(op.id)) {
        const cleanup = bindOperatorToTheatre(op, theatreSheet)
        if (cleanup) {
          newCleanupFns.set(op.id, cleanup)
        }
      }
    }

    // Cleanup operators that are no longer in the graph
    const currentOperatorIds = new Set(operators.map(op => op.id))
    cleanupRemovedOperators(currentOperatorIds, theatreSheet)

    // Return cleanup function only for newly bound operators
    return () => {
      for (const cleanup of newCleanupFns.values()) {
        cleanup()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theatreReady, theatreSheet, operators])

  // Use shared hook for project modifications
  const {
    onConnect: onConnectBase,
    onNodesDelete: onNodesDeleteBase,
    updateOperatorId,
  } = useProjectModifications({
    getNodes: useCallback(() => nodes, [nodes]),
    getEdges: useCallback(() => edges, [edges]),
    setNodes,
    setEdges,
  })

  // Wrap onConnect to mark unsaved changes
  const onConnect = useCallback(
    (connection: Connection) => {
      onConnectBase(connection)
      setHasUnsavedChanges(true)
    },
    [onConnectBase]
  )

  // Wrap onNodesDelete to mark unsaved changes
  const onNodesDelete = useCallback(
    (deleted: ReactFlowNode[]) => {
      onNodesDeleteBase(deleted)
      setHasUnsavedChanges(true)
    },
    [onNodesDeleteBase]
  )

  // Wrap onReconnect to mark unsaved changes
  const onReconnect = useCallback(
    (oldEdge: ReactFlowEdge, newConnection: Connection) => {
      setEdges(els => reconnectEdge(oldEdge, newConnection, els))
      setHasUnsavedChanges(true)
    },
    [setEdges]
  )

  const onNodeClick = useCallback((_e: React.MouseEvent, node: ReactFlowNode<unknown>) => {
    const store = getOpStore()
    const obj = store.getSheetObject(node.id)
    if (obj) {
      studio.setSelection([obj])
    } else {
      studio.setSelection([])
    }
  }, [])

  const reactFlowRef = useRef<HTMLDivElement>(null)
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const blockLibraryRef = useRef<BlockLibraryRef>(null)

  // Avoid circular dependency
  const loadProjectFileRef = useRef<(project: NoodlesProjectJSON, name?: string) => void>()

  const currentProjectRef = useRef<NoodlesProjectJSON>(newProjectJSON)

  // Track when we're programmatically loading a project to prevent useEffect from trying to reload
  const isProgrammaticLoadRef = useRef(false)

  // Ref to access undo/redo and copy/paste functionality from inside ReactFlow context
  const undoRedoRef = useRef<UndoRedoHandlerRef>(null)
  const copyControlsRef = useRef<CopyControlsRef>(null)

  // Helper component to capture ReactFlow instance
  function ReactFlowInstanceCapture() {
    const instance = useReactFlow()
    reactFlowInstanceRef.current = instance
    return null
  }

  const onDeselectAll = useCallback(() => {
    setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
    setEdges(edges => edges.map(edge => ({ ...edge, selected: false })))
  }, [setNodes, setEdges])

  const onPaneClick = useCallback(() => {
    blockLibraryRef.current?.closeModal()
    onDeselectAll()
  }, [onDeselectAll])

  const onPaneContextMenu = useCallback((event: React.MouseEvent<Element, MouseEvent>) => {
    event.preventDefault()
    // Show Block Library at the right-click position
    analytics.track('block_library_opened', { method: 'context_menu' })
    blockLibraryRef.current?.openModal(event.clientX, event.clientY)
  }, [])

  const currentContainerId = useNestingStore(state => state.currentContainerId)

  // Handle 'v' keyup to create ViewerOp (momentary button behavior)
  useKeyboardShortcut('v', () => {
    analytics.track('viewer_created', { method: 'keyboard' })

    setNodes(currentNodes => {
      const selectedNodes = currentNodes.filter(n => n.selected)
      const store = getOpStore()
      const hoveredHandle = store.hoveredOutputHandle
      if (selectedNodes.length === 0) {
        if (hoveredHandle) {
          const hoveredNode = currentNodes.find(n => n.id === hoveredHandle.nodeId)
          if (hoveredNode) {
            const newViewerPosition = {
              x: hoveredNode.position.x + VIEWER_OFFSET_X,
              y: hoveredNode.position.y,
            }

            const viewerId = nodeId('viewer', currentContainerId)

            const viewerNode: AnyNodeJSON = {
              id: viewerId,
              type: 'ViewerOp',
              position: newViewerPosition,
              data: undefined,
            }

            const sourceHandle = hoveredHandle.handleId
            const targetHandle = 'par.data'
            const newEdge = {
              id: edgeId({
                source: hoveredHandle.nodeId,
                sourceHandle,
                target: viewerId,
                targetHandle,
              }),
              source: hoveredHandle.nodeId,
              sourceHandle,
              target: viewerId,
              targetHandle,
            }

            setEdges(currentEdges => [...currentEdges, newEdge])
            return [...currentNodes, viewerNode]
          }
        }
        return currentNodes
      }

      // Find the rightmost selected node
      const rightmostNode = selectedNodes.reduce((rightmost, node) => {
        return node.position.x > rightmost.position.x ? node : rightmost
      }, selectedNodes[0])

      // Calculate position for new ViewerOp (to the right of the rightmost node)
      const newViewerPosition = {
        x: rightmostNode.position.x + VIEWER_OFFSET_X,
        y: rightmostNode.position.y,
      }

      const viewerId = nodeId('viewer', currentContainerId)

      // Create the ViewerOp node
      const viewerNode: AnyNodeJSON = {
        id: viewerId,
        type: 'ViewerOp',
        position: newViewerPosition,
        data: undefined,
      }

      // Determine sourceHandle to use
      let sourceNodeId = rightmostNode.id
      let sourceHandle: string | null = null

      // Check if a handle is hovered (from shared store)
      if (hoveredHandle && selectedNodes.some(n => n.id === hoveredHandle.nodeId)) {
        // Use hovered handle if it's on a selected node
        // Handle ID is already in the format "out.fieldName"
        if (hoveredHandle.handleId.startsWith('out.')) {
          sourceNodeId = hoveredHandle.nodeId
          sourceHandle = hoveredHandle.handleId
        }
      }

      // If no hovered handle, use the first output handle of the rightmost node
      if (!sourceHandle) {
        const sourceOp = store.getOp(sourceNodeId)
        if (sourceOp) {
          const firstOutputKey = Object.keys(sourceOp.outputs)[0]
          if (firstOutputKey) {
            sourceHandle = `out.${firstOutputKey}`
          }
        }
      }

      // Create edge if we have a valid source handle
      if (sourceHandle) {
        const targetHandle = 'par.data'
        const newEdge = {
          id: edgeId({
            source: sourceNodeId,
            sourceHandle,
            target: viewerId,
            targetHandle,
          }),
          source: sourceNodeId,
          sourceHandle,
          target: viewerId,
          targetHandle,
        }

        // Add edge
        setEdges(currentEdges => [...currentEdges, newEdge])
      }

      return [...currentNodes, viewerNode]
    })
  }, [setNodes, setEdges, currentContainerId])

  // Handle 'a' keyup to open Block Library (momentary button behavior)
  useKeyboardShortcut('a', () => {
    analytics.track('block_library_opened', { method: 'keyboard' })

    // Open Block Library at center of screen
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return

    const centerX = pane.left + pane.width / 2
    const centerY = pane.top + pane.height / 2
    blockLibraryRef.current?.openModal(centerX, centerY)
  }, [])

  // Editor settings state (moved from Theatre.js to project-level settings)
  const [showOverlay, setShowOverlay] = useState(!IS_PROD)
  const [layoutMode, setLayoutMode] = useState<'split' | 'noodles-on-top' | 'output-on-top'>(
    'noodles-on-top'
  )

  const loadProjectFile = useCallback(
    (project: NoodlesProjectJSON, name?: string) => {
      const { nodes, edges, viewport, timeline, editorSettings, apiKeys } = project

      // Update current project ref for undo/redo
      currentProjectRef.current = project

      const store = getOpStore()
      for (const op of store.getAllOps()) {
        op.unsubscribeListeners()
      }
      store.clearOps()
      setNodes(nodes)
      setEdges(edges)
      setProjectName(name ?? null)

      // Load editor settings from project with defaults
      setLayoutMode(editorSettings?.layoutMode ?? 'noodles-on-top')
      setShowOverlay(editorSettings?.showOverlay ?? !IS_PROD)

      // Load API keys from project file if present
      getKeysStore().setProjectKeys(apiKeys)

      // Set viewport state before ReactFlow renders (but not during undo/redo)
      if (viewport && name && !undoRedoRef.current?.isRestoring()) {
        setDefaultViewport(viewport)
      }

      // Only include timeline state if it exists and has content, otherwise use empty config
      const hasTimeline = timeline && Object.keys(timeline).length > 0
      setTheatreProject(name && hasTimeline ? { state: timeline } : {}, name)

      // Update URL query parameter with project name
      if (name) {
        navigate(`${routePrefix}/${name ?? ''}`, { replace: true })
      }

      // Clear unsaved changes flag when loading a project
      setHasUnsavedChanges(false)

      // Mark that we've programmatically loaded this project
      // This prevents the useEffect from trying to reload it from storage
      isProgrammaticLoadRef.current = true
    },
    [setNodes, setEdges, setProjectName, setTheatreProject, navigate, routePrefix]
  )

  // Assign to ref for undo/redo system
  loadProjectFileRef.current = loadProjectFile

  // Keyboard shortcuts are now handled by UndoRedoHandler component

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadProjectFile would cause infinite loop
  useEffect(() => {
    ;(async () => {
      // If this is a programmatic load (from onNewProject, onImport, etc.),
      // skip loading from storage to avoid showing the "Project Not Found" dialog
      if (isProgrammaticLoadRef.current) {
        isProgrammaticLoadRef.current = false
        return
      }

      // If no projectName, load the default new project
      if (!projectName || projectName === 'new') {
        try {
          loadProjectFile(newProjectJSON as NoodlesProjectJSON)
          return
        } catch (_error) {
          console.error('Failed to load default new project:', _error)
        }
        return
      }

      // First try to load from static files (for built-in examples)
      const projectKey = `../examples/${projectName}/noodles.json`
      const projectUrl = exampleProjectUrls[projectKey] as string | undefined

      if (projectUrl) {
        try {
          const response = await fetch(projectUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch example project: ${response.statusText}`)
          }
          const noodlesFile = (await response.json()) as Partial<NoodlesProjectJSON>
          const project = await migrateProject({
            ...EMPTY_PROJECT,
            ...noodlesFile,
          } as NoodlesProjectJSON)
          // Set project name and storage type for public projects so @/ asset paths work
          setCurrentDirectory(null, projectName)
          setActiveStorageType('publicFolder')
          loadProjectFile(project, projectName)
          return
        } catch (error) {
          console.error('Failed to load example project:', error)
          // Fall through to try storage
        }
      }

      console.log('Static project file not found, trying storage...')

      // Try to load from storage (OPFS or File System Access API)
      try {
        const result = await load(storageType, projectName)
        if (result.success) {
          const project = await migrateProject(result.data.projectData)
          // Update store with directory handle, project name, and storage type
          setCurrentDirectory(result.data.directoryHandle, projectName)
          // storageType here is already correct (opfs or fileSystemAccess)
          loadProjectFile(project, projectName)
        } else {
          // Project not found in storage - show dialog
          if (result.error.type === 'not-found') {
            setShowProjectNotFoundDialog(true)
          } else {
            setError(result.error)
          }
        }
      } catch (error) {
        setError({
          type: 'unknown',
          message: 'Error loading project',
          details: error instanceof Error ? error.message : 'Unknown error',
          originalError: error,
        })
      }
    })()
  }, [projectName])

  const displayedNodes = useMemo(() => {
    const dragHandle = `.${s.header}`
    const targetContainerId = currentContainerId || '/'

    return nodes
      .filter(node => (getParentPath(node.id) ?? '/') === targetContainerId)
      .map(node => ({
        ...node,
        hidden: false,
        dragHandle,
      }))
  }, [currentContainerId, nodes])

  const visibleNodeIds = useMemo(() => {
    return new Set(displayedNodes.map(node => node.id))
  }, [displayedNodes])

  const activeEdges = useMemo(() => {
    return edges
      .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
      .map(edge => ({
        ...edge,
        sourceHandle: edge.type === 'ReferenceEdge' ? null : edge.sourceHandle,
      }))
  }, [edges, visibleNodeIds])

  // File menu callbacks
  const getNoodlesProjectJson = useCallback((): NoodlesProjectJSON => {
    const store = getOpStore()
    const timeline = getTimelineJson()
    const viewport = reactFlowInstanceRef.current?.getViewport() || { x: 0, y: 0, zoom: 1 }
    const projectKeys = getKeysForProject()

    return {
      version: NOODLES_VERSION,
      nodes: serializeNodes(store, nodes, edges),
      edges: serializeEdges(store, nodes, edges),
      viewport,
      timeline,
      editorSettings: {
        layoutMode,
        showOverlay,
      },
      ...(projectKeys ? { apiKeys: projectKeys } : {}),
    }
  }, [nodes, edges, getTimelineJson, layoutMode, showOverlay])

  const onMenuSave = useCallback(async () => {
    if (!projectName) return
    const noodlesProjectJson = getNoodlesProjectJson()
    const result = await save(storageType, projectName, noodlesProjectJson)
    if (result.success) {
      setCurrentDirectory(result.data.directoryHandle, projectName)
      setHasUnsavedChanges(false)
      analytics.track('project_saved', { storageType })
    } else {
      setError(result.error)
    }
  }, [projectName, getNoodlesProjectJson, storageType, setCurrentDirectory, setError])

  const onDownload = useCallback(async () => {
    const noodlesProjectJson = getNoodlesProjectJson()
    await saveProjectLocally(projectName || 'untitled', noodlesProjectJson, storageType)
    analytics.track('project_exported', { storageType })
  }, [projectName, getNoodlesProjectJson, storageType])

  const onOpenAddNode = useCallback(() => {
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return
    const centerX = pane.left + pane.width / 2
    const centerY = pane.top + pane.height / 2
    blockLibraryRef.current?.openModal(centerX, centerY)
  }, [])

  const onNewProject = useCallback(async () => {
    try {
      // Prompt user to select/create a directory for the new project
      const directoryHandle = await selectDirectory()
      const directoryName = directoryHandle.name

      // Ensure we have write permission
      const hasPermission = await requestPermission(directoryHandle, 'readwrite')
      if (!hasPermission) {
        console.error('Permission denied to write to directory')
        return
      }

      // Write starter project to noodles.json
      const starterProject = {
        ...newProjectJSON,
        version: NOODLES_VERSION,
      } as NoodlesProjectJSON
      await writeFileToDirectory(directoryHandle, 'noodles.json', safeStringify(starterProject))

      // Cache the directory handle
      await directoryHandleCache.cacheHandle(directoryName, directoryHandle, directoryHandle.name)

      // Update store with directory handle
      setCurrentDirectory(directoryHandle, directoryName)

      // Load the project directly (already in memory, no need to reload from disk)
      loadProjectFile(starterProject, directoryName)

      analytics.track('project_created', { method: 'new' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the picker
        return
      }
      console.error('Failed to create new project:', error)
    }
  }, [setCurrentDirectory, loadProjectFile])

  const onImport = useCallback(async () => {
    try {
      // First, prompt for the project file to import
      const [fileHandle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Noodles Project',
            accept: {
              'application/json': ['.json'],
              'application/zip': ['.zip'],
            },
          },
        ],
      })
      const file = await fileHandle.getFile()
      const isZip = file.name.endsWith('.zip')

      let projectData: NoodlesProjectJSON
      const filesToWrite: Map<string, string | ArrayBuffer> = new Map()

      if (isZip) {
        // Handle ZIP import
        const zip = await JSZip.loadAsync(await file.arrayBuffer())

        // Find noodles.json in the ZIP (could be at root or in a subfolder)
        let noodlesJsonPath: string | null = null
        let projectFolder = ''

        // Iterate over files in the ZIP to find noodles.json
        zip.forEach((relativePath, zipEntry) => {
          if (relativePath.endsWith('noodles.json') && !zipEntry.dir) {
            noodlesJsonPath = relativePath
            // Extract the folder path (everything before noodles.json)
            projectFolder = relativePath.substring(0, relativePath.lastIndexOf('noodles.json'))
          }
        })

        if (!noodlesJsonPath) {
          throw new Error('No noodles.json found in ZIP file')
        }

        // Parse noodles.json
        const noodlesJsonFile = zip.file(noodlesJsonPath)
        if (!noodlesJsonFile) {
          throw new Error('Could not read noodles.json from ZIP')
        }
        const noodlesJsonText = await noodlesJsonFile.async('text')
        const parsed = JSON.parse(noodlesJsonText) as Partial<NoodlesProjectJSON>
        projectData = await migrateProject({
          ...EMPTY_PROJECT,
          ...parsed,
        } as NoodlesProjectJSON)

        // Extract all files from the ZIP
        const fileEntries: Array<[string, JSZipObject]> = []
        zip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir) {
            fileEntries.push([relativePath, zipEntry])
          }
        })

        for (const [relativePath, zipEntry] of fileEntries) {
          // Remove the project folder prefix to get relative path within project
          let cleanPath = relativePath
          if (projectFolder && relativePath.startsWith(projectFolder)) {
            cleanPath = relativePath.substring(projectFolder.length)
          }

          // Read file contents
          if (cleanPath.endsWith('.json')) {
            const text = await zipEntry.async('text')
            filesToWrite.set(cleanPath, text)
          } else {
            const arrayBuffer = await zipEntry.async('arraybuffer')
            filesToWrite.set(cleanPath, arrayBuffer)
          }
        }

        // Write migrated noodles.json (overwrites any unmigrated version extracted from ZIP)
        filesToWrite.set('noodles.json', safeStringify(projectData))
      } else {
        // Handle single JSON file import
        const text = await file.text()
        const parsed = JSON.parse(text) as Partial<NoodlesProjectJSON>
        projectData = await migrateProject({
          ...EMPTY_PROJECT,
          ...parsed,
        } as NoodlesProjectJSON)

        // Only write noodles.json
        filesToWrite.set('noodles.json', safeStringify(projectData))
      }

      // Now prompt for directory to save the imported project
      const directoryHandle = await selectDirectory()
      const directoryName = directoryHandle.name

      // Ensure we have write permission
      const hasPermission = await requestPermission(directoryHandle, 'readwrite')
      if (!hasPermission) {
        console.error('Permission denied to write to directory')
        return
      }

      // Write all files to directory
      for (const [path, content] of filesToWrite.entries()) {
        // Handle nested paths (e.g., data/file.csv)
        if (path.includes('/')) {
          const parts = path.split('/')
          const fileName = parts.pop()!
          const subfolders = parts

          // Create nested directory structure
          let currentDir = directoryHandle
          for (const folder of subfolders) {
            currentDir = await currentDir.getDirectoryHandle(folder, { create: true })
          }

          // Write file in the nested directory
          const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(content)
          await writable.close()
        } else {
          // Write file at root level
          await writeFileToDirectory(directoryHandle, path, content)
        }
      }

      // Cache the directory handle
      await directoryHandleCache.cacheHandle(directoryName, directoryHandle, directoryHandle.name)

      // Update store with directory handle
      setCurrentDirectory(directoryHandle, directoryName)

      // Load the project directly (already in memory, no need to reload from disk)
      loadProjectFile(projectData, directoryName)

      analytics.track('project_imported', { format: isZip ? 'zip' : 'json' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the picker
        return
      }
      console.error('Failed to import project:', error)
    }
  }, [setCurrentDirectory, loadProjectFile])

  const onOpen = useCallback(
    async (projectName?: string) => {
      try {
        let result: Awaited<ReturnType<typeof load>>
        let finalProjectName: string

        if (projectName) {
          // Load project by name (for recent projects and OPFS list)
          // Cache-aware: load will prompt user if project directory not cached for fileSystemAccess
          finalProjectName = projectName
          result = await load(storageType, projectName)
        } else {
          // Show the native folder picker
          const projectDirectory = await selectDirectory()
          finalProjectName = projectDirectory.name

          // Cache the directory handle
          await directoryHandleCache.cacheHandle(
            finalProjectName,
            projectDirectory,
            projectDirectory.name
          )

          // Load project from the selected directory
          result = await load(storageType, projectDirectory)
        }

        if (result.success) {
          const project = await migrateProject(result.data.projectData)
          loadProjectFile(project, finalProjectName)
          // Update store with directory handle returned from load
          setCurrentDirectory(result.data.directoryHandle, finalProjectName)
          analytics.track('project_opened', { storageType })
        } else {
          setError(result.error)
          analytics.track('project_open_failed', { storageType, error: 'load_error' })
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // User cancelled the picker
          return
        }
        console.error('Failed to open project:', error)
        setError({
          type: 'unknown',
          message:
            error instanceof Error && projectName
              ? 'Error migrating project'
              : 'Error opening folder',
          details: error instanceof Error ? error.message : 'Unknown error',
          originalError: error,
        })
        analytics.track('project_open_failed', {
          storageType,
          error: projectName ? 'migration_error' : 'unknown',
        })
      }
    },
    [storageType, loadProjectFile, setCurrentDirectory, setError]
  )

  const flowGraph = theatreReady && (
    <ErrorBoundary>
      <div className={cx('react-flow-wrapper', !showOverlay && 'react-flow-wrapper-hidden')}>
        <PrimeReactProvider>
          <SheetProvider value={theatreSheet}>
            <ReactFlow
              ref={reactFlowRef}
              nodes={displayedNodes}
              edges={activeEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onNodeClick={onNodeClick}
              onNodesDelete={onNodesDelete}
              onPaneContextMenu={onPaneContextMenu}
              onPaneClick={onPaneClick}
              minZoom={0.2}
              fitViewOptions={fitViewOptions}
              defaultEdgeOptions={defaultEdgeOptions}
              defaultViewport={defaultViewport}
              nodeTypes={nodeComponents}
              edgeTypes={edgeComponents}
            >
              <ReactFlowInstanceCapture />
              <Background />
              <Controls position="bottom-right" />
              <BlockLibrary ref={blockLibraryRef} reactFlowRef={reactFlowRef} />
              <CopyControls ref={copyControlsRef} />
              <UndoRedoHandler ref={undoRedoRef} />
              <ChatPanel
                project={{ nodes, edges }}
                onClose={() => setShowChatPanel(false)}
                isVisible={showChatPanel}
              />
            </ReactFlow>
          </SheetProvider>
        </PrimeReactProvider>
        <ProjectNotFoundDialog
          projectName={projectName || ''}
          open={showProjectNotFoundDialog}
          onProjectLoaded={(project, name) => {
            loadProjectFile(project, name)
            setShowProjectNotFoundDialog(false)
          }}
          onNewProject={onNewProject}
          onImport={onImport}
          onClose={() => setShowProjectNotFoundDialog(false)}
        />
        <StorageErrorHandler />
      </div>
    </ErrorBoundary>
  )

  // Assume there's always one 'out' op.
  const OUT_OP_ID = '/out'
  const outOp = operators.find(n => n.id === OUT_OP_ID)! as unknown as OutOp

  const [visProps, setVisProps] = useState(outOp?.inputs.vis.value || {})

  // Create overlay layer for selected GeoJSON-producing operators
  const selectedGeoJsonFeatures = useMemo(() => {
    const features: unknown[] = []
    const selectedNodes = nodes.filter(n => n.selected)
    const store = getOpStore()

    for (const node of selectedNodes) {
      const op = store.getOp(node.id)
      if (!op) continue

      // Check if this is a GeoJSON-producing operator
      if (categories.geojson.includes(nodeTypeToDisplayName(node.type))) {
        const feature = op.outputs.feature?.value
        if (feature) features.push(feature)
      }
    }

    return features
  }, [nodes])

  useEffect(() => {
    if (outOp) {
      const visSub = outOp.inputs.vis.subscribe(
        ({ deckProps: { layers, widgets, ...deckProps }, mapProps }) => {
          // Map layers from POJOs to deck.gl instances
          const instantiatedLayers =
            layers?.map(({ type, extensions, ...layer }) => {
              // Instantiate extensions from POJOs if present
              let instantiatedExtensions: unknown[] | undefined
              if (extensions && Array.isArray(extensions)) {
                instantiatedExtensions = extensions
                  .map((ext: { type: string; [key: string]: unknown }) => {
                    const { type: extType, ...constructorArgs } = ext
                    const extensionDef = extensionMap[extType]
                    if (!extensionDef) {
                      console.warn(`Unknown extension type: ${extType}`)
                      return null
                    }

                    // Check if it's a wrapped extension (with ExtensionClass and args)
                    if (typeof extensionDef === 'object' && 'ExtensionClass' in extensionDef) {
                      return new extensionDef.ExtensionClass(extensionDef.args)
                    }

                    // It's a direct class constructor
                    const ExtensionClass = extensionDef as new (
                      ...args: unknown[]
                    ) => LayerExtension
                    return Object.keys(constructorArgs).length > 0
                      ? new ExtensionClass(constructorArgs)
                      : new ExtensionClass()
                  })
                  .filter((e): e is LayerExtension => e !== null)
              }

              return new deck[type]({
                ...layer,
                ...(instantiatedExtensions ? { extensions: instantiatedExtensions } : {}),
              })
            }) || []

          // Add overlay layer for selected GeoJSON features
          if (selectedGeoJsonFeatures.length > 0) {
            const overlayLayer = new deck.GeoJsonLayer({
              id: 'selected-geojson-overlay',
              data: selectedGeoJsonFeatures,
              filled: true,
              stroked: true,
              getFillColor: [255, 0, 0, 100], // Red with transparency
              getLineColor: [255, 0, 0, 255], // Red outline
              getLineWidth: 2,
              lineWidthMinPixels: 2,
              getPointRadius: 10,
              pointRadiusMinPixels: 10,
            })
            instantiatedLayers.push(overlayLayer)
          }

          setVisProps({
            deckProps: {
              ...deckProps,
              // biome-ignore lint/performance/noDynamicNamespaceImportAccess: We intentionally support all deck.gl layer types dynamically
              layers: instantiatedLayers,
              widgets: widgets?.map(({ type, ...widget }) => new deckWidgets[type](widget)),
            },
            mapProps,
          })
        }
      )
      return () => {
        visSub.unsubscribe()
      }
    }
  }, [outOp, selectedGeoJsonFeatures])

  const propertiesPanel = (
    <div className={s.rightPanel}>
      <PropertyPanel />
    </div>
  )

  return {
    flowGraph,
    nodeSidebar: <NodeTreeSidebar updateOperatorId={updateOperatorId} />,
    propertiesPanel,
    layoutMode,
    setLayoutMode,
    showOverlay,
    setShowOverlay,
    // Export these so timeline-editor can create the menu with render actions
    projectName,
    getTimelineJson,
    onSaveProject: onMenuSave,
    onDownload,
    onNewProject,
    onImport,
    onOpen,
    onOpenAddNode,
    undoRedoRef,
    copyControlsRef,
    reactFlowRef,
    showChatPanel,
    setShowChatPanel,
    hasUnsavedChanges,
    ...visProps,
    project: theatreProject,
    sheet: theatreSheet,
  }
}
