import type { AnyNodeJSON } from 'SKIP-@xyflow/react'
import * as deckWidgets from '@deck.gl/widgets'
import type {
  Connection,
  DefaultEdgeOptions,
  FitViewOptions,
  OnConnectEnd,
  OnConnectStart,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
} from '@xyflow/react'
import {
  Background,
  Controls,
  ReactFlow,
  type ReactFlowInstance,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'
import cx from 'classnames'
import type { LayerExtension } from 'deck.gl'
import * as deck from 'deck.gl'
import type { JSZipObject } from 'jszip'
import { PrimeReactProvider } from 'primereact/api'
import {
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useLocation, useParams } from 'wouter'
import { globalContextManager } from '../ai-chat/global-context-manager'
import type { NoodlesProject } from '../ai-chat/types'
import { getPendingQuickStartAction, planQuickStartAction } from '../components/quick-start-modal'
import { analytics } from '../utils/analytics'
import { lazyWithReload, staleChunk } from '../utils/stale-chunk'
import { setCurrentProject, setModificationApplier } from '../webmcp/bridge'
import { agentBench, externalControl } from './globals'
import { getKeysForProject, getKeysStore } from './keys-store'
import newProjectJSON from './new.json'
import { BitmapOverlayWidget, type BitmapOverlayWidgetProps } from './widgets/bitmap-overlay-widget'
import { LegendWidget, type LegendWidgetProps } from './widgets/legend-widget'

// Get URLs for all example noodles.json files (lazy-loaded)
const exampleProjectUrls = import.meta.glob('../examples/**/noodles.json', {
  eager: true,
  query: '?url',
  import: 'default',
})

import {
  bindOperatorToTimeline,
  cleanupRemovedOperators as cleanupRemovedOperatorsNative,
  clearAllBindings,
} from '../timeline/field-bindings'
import { TimelineProvider } from '../timeline/timeline-context'
import { getTimelineStore } from '../timeline/timeline-store'
import type { Visualization } from '../visualizations'
import { BlockLibrary, type BlockLibraryRef } from './components/block-library'
import { CanvasQuickstart, CanvasQuickstartButton } from './components/canvas-quickstart'
import { categories, nodeTypeToDisplayName } from './components/categories'
import { CopyControls, type CopyControlsRef } from './components/copy-controls'
import { CreateFromSQLDialog } from './components/create-from-sql-dialog'
import { NodeInfoOverlay, ViewportInfoPanel } from './components/devtools'
import { ErrorBoundary } from './components/error-boundary'
import { ExampleNotFoundDialog } from './components/example-not-found-dialog'
import { type GraphError, GraphErrorDialog } from './components/graph-error-dialog'
import { LayerPanel } from './components/layer-panel'
import { PropertyPanel } from './components/node-properties'
import { NodeTreeSidebar } from './components/node-tree-sidebar'
import { edgeComponents, nodeComponents } from './components/op-components'
import { ParameterEditorDialog } from './components/parameter-editor-dialog'
import {
  ProjectNotFoundDialog,
  type ProjectOpenProblem,
} from './components/project-not-found-dialog'
import { RenameDialog } from './components/rename-dialog'
import { SaveAsDialog } from './components/save-as-dialog'
import { SidebarTabs } from './components/sidebar-tabs'
import { MapPickFocus, ProjectLoadView } from './components/starter-node-focus'
import { StorageErrorHandler } from './components/storage-error-handler'
import { CanvasDropImport } from './components/tools/canvas-drop-import'
import { UndoRedoHandler, type UndoRedoHandlerRef } from './components/UndoRedoHandler'
import { ProjectModificationActionsProvider } from './contexts/project-modification-actions-context'
import { useActiveStorageType, useFileSystemStore } from './filesystem-store'
import { findEdgeAtPosition, useConnectionDropOnEdge } from './hooks/use-connection-drop-on-edge'
import { useKeyboardShortcut } from './hooks/use-keyboard-shortcut'
import { useNodeDropOnEdge } from './hooks/use-node-drop-on-edge'
import { useProjectModifications } from './hooks/use-project-modifications'
import type { DeckRendererOp, IOperator, Operator, OutOp } from './operators'
import { instantiateExtension, opTypes } from './operators'
import { referenceDependencyModel } from './reference-dependencies'
import {
  copyDataDirectory,
  copyExampleAssetsToMemory,
  copyMemoryDataToDirectory,
  copyPublicFolderData,
  hasDataDirectory,
  load,
  openFailureReason,
  readMemoryOutputCache,
  save,
} from './storage'
import {
  clearPendingInsertionIndex,
  getOp,
  getOpStore,
  getUIStore,
  useEdgeConnectionStore,
  useGraphStore,
  useNestingStore,
  useUIStore,
} from './store'
import { markUnknownOperatorNodes, transformGraph } from './transform-graph'
import { layoutNodes } from './utils/auto-layout'
import { canConnectCached } from './utils/can-connect'
import { createProjectFromSQL, takeCreateFromSQLRequest } from './utils/create-from-sql'
import { DeckProjectAssetResolver } from './utils/deck-project-asset-resolver'
import { instantiateDeckView } from './utils/deck-view'
import { directoryHandleCache } from './utils/directory-handle-cache'
import { insertUniqueEdge } from './utils/edge-integrity'
import { trackChatClosed, trackChatOpened } from './utils/editor-analytics'
import {
  fileExists,
  requestPermission,
  selectDirectory,
  writeFileToDirectory,
} from './utils/filesystem'
import { reconcileForLoopGroups } from './utils/for-loop-group-utils'
import { shouldAutosave, supportsVersioning, useGitSettings } from './utils/git-settings'
import { edgeId, nodeId } from './utils/id-utils'
import { shouldBlockKeyboardShortcut } from './utils/input-detection'
import { generateDraftId, memoryProjectStore } from './utils/memory-project-store'
import { migrateProject } from './utils/migrate-schema'
import { normalizeMultiInputEdges } from './utils/multi-input-utils'
import {
  CACHE_DIRECTORY_NAME,
  type OutputCache,
  serializeOutputCache,
  writeOutputCache,
} from './utils/output-cache'
import { getParentPath, parseHandleId } from './utils/path-utils'
import { applyOperatorInputs, getLastCommittedBeforeState } from './utils/property-history'
import {
  type AutoLayoutSettings,
  DEFAULT_AUTO_LAYOUT,
  EMPTY_PROJECT,
  NOODLES_VERSION,
  type NoodlesProjectJSON,
  safeStringify,
  saveProjectLocally,
  serializeEdges,
  serializeNodes,
} from './utils/serialization'
import { EdgeSpatialIndex } from './utils/spatial-index'
import { claimStarterSelection, findStarterNodeId } from './utils/starter-node'
import { expandTimelineIfAnimated } from './utils/timeline-panel'
import { calculateViewerPosition } from './utils/viewer-position'

const ChatPanel = lazyWithReload(() =>
  import('../ai-chat/chat-panel').then(m => ({ default: m.ChatPanel }))
)
const GitHistoryPanel = lazyWithReload(() =>
  import('./components/git-history-panel').then(m => ({ default: m.GitHistoryPanel }))
)

/*
 * CSS Architecture:
 * - layers.css: Establishes CSS layers and imports vendor CSS into 'vendors' layer
 * - noodles.module.css: Component styles and critical unlayered overrides
 *
 * CSS layers ensure vendor styles have lowest priority, making our overrides
 * work reliably regardless of import order (prevents linting from breaking styles).
 */
import './layers.css'
import { debugApp, debugParams, debugVis } from '../utils/debug'
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

// Click-to-edit (map-click-to-edit.tsx) is off when an agent drives the editor, and so is
// the pickable default it needs
const EDITOR_PICKING = !externalControl && !agentBench

const isLayerType = (type: string) =>
  (opTypes[type as keyof typeof opTypes]?.displayName ?? '').endsWith('Layer')

// Syncs edge data from React Flow store to centralized EdgeConnectionStore for O(1) lookups
function EdgeConnectionSynchronizer() {
  const store = useStoreApi()
  const prevEdgesRef = useRef<ReactFlowEdge[] | null>(null)

  useEffect(() => {
    const unsubscribe = store.subscribe(state => {
      // Skip if edges array identity hasn't changed (position-only updates)
      if (prevEdgesRef.current === state.edges) {
        return
      }
      prevEdgesRef.current = state.edges
      useEdgeConnectionStore.getState().updateFromEdges(state.edges)
    })
    // Initial sync
    const currentEdges = store.getState().edges
    prevEdgesRef.current = currentEdges
    useEdgeConnectionStore.getState().updateFromEdges(currentEdges)
    return unsubscribe
  }, [store])

  return null
}

export function getNoodles(): Visualization {
  const [location, navigate] = useLocation()
  const params = useParams()

  // Get projectId from route params (/examples/:projectId or /projects/:projectId) - router is single source of truth
  const projectName = params.projectId ?? null

  // Detect if we're on /projects or /examples route to preserve it when navigating
  const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'
  const isExamplesRoute = routePrefix === '/examples'
  const isNewProjectRoute = projectName === 'new'
  const isProjectsRoute = routePrefix === '/projects' && !isNewProjectRoute

  const [projectOpenProblem, setProjectOpenProblem] = useState<{
    reason: ProjectOpenProblem
    directoryHandle?: FileSystemDirectoryHandle
  } | null>(null)
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [saveAsOptions, setSaveAsOptions] = useState<{
    targetHandle: FileSystemDirectoryHandle | null
    hasExistingProject: boolean
    hasDataFiles: boolean
  } | null>(null)
  const [showExampleNotFoundDialog, setShowExampleNotFoundDialog] = useState(false)
  const [pendingCreateFromSQL, setPendingCreateFromSQL] = useState<string | null>(null)
  // A ?createFromSQL= link opens CreateFromSQLDialog; the project is created only on confirm.
  // Declared before the project-loading effects, whose navigate() drops the query string.
  useEffect(() => {
    const request = takeCreateFromSQLRequest()
    if (!request) return
    if ('sql' in request) {
      setPendingCreateFromSQL(request.sql)
    } else {
      console.error('Invalid SQL query:', request.error)
      alert(`Invalid SQL query: ${request.error}`)
    }
  }, [])
  const [graphErrors, setGraphErrors] = useState<GraphError[]>([])
  const storageType = useActiveStorageType()
  const {
    currentDirectory,
    currentProjectName: storedProjectName,
    setCurrentDirectory,
    setActiveStorageType,
    setError,
  } = useFileSystemStore()
  const timelineStore = getTimelineStore()
  const getTimelineJson = useCallback((): Record<string, unknown> => {
    return timelineStore.toTimelineJSON() as unknown as Record<string, unknown>
  }, [timelineStore.toTimelineJSON])

  // Nodes, edges and operators live in the graph store. setNodes/setEdges keep the
  // React state-setter shape, but updaters read the store's latest state, so several
  // updates in one tick compose instead of overwriting each other.
  const nodes = useGraphStore(state => state.nodes) as AnyNodeJSON[]
  const edges = useGraphStore(state => state.edges)
  const onNodesChangeBase = useGraphStore(state => state.applyNodeChanges)
  const onEdgesChangeBase = useGraphStore(state => state.applyEdgeChanges)
  const setNodes = useCallback((update: SetStateAction<AnyNodeJSON[]>) => {
    useGraphStore.setState(state => ({
      nodes: typeof update === 'function' ? update(state.nodes as AnyNodeJSON[]) : update,
    }))
  }, [])
  const setEdges = useCallback((update: SetStateAction<ReactFlowEdge[]>) => {
    useGraphStore.setState(state => ({
      edges: typeof update === 'function' ? update(state.edges) : update,
    }))
  }, [])
  const referenceEdges = useSyncExternalStore(
    referenceDependencyModel.subscribe,
    referenceDependencyModel.getSnapshot,
    referenceDependencyModel.getSnapshot
  )
  const modelEdges = useMemo<ReactFlowEdge[]>(
    () => [...(edges as ReactFlowEdge[]), ...referenceEdges],
    [edges, referenceEdges]
  )

  useEffect(() => () => referenceDependencyModel.reset(), [])

  // The graph store outlives this component. Start each editor session empty, as React
  // state did, so the previous project's graph never shows (or saves) under the next one.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      useGraphStore.setState({ nodes: [], edges: [] })
    }
  }, [])

  useEffect(() => {
    const inspectedEdge = getUIStore().inspectedReferenceEdge
    if (inspectedEdge && !referenceEdges.some(edge => edge.id === inspectedEdge.id)) {
      getUIStore().setInspectedReferenceEdge(null)
    }
  }, [referenceEdges])

  // Single ref providing synchronous access to the full graph state.
  // Used by CopyControls, UndoRedoHandler, and hooks that need all nodes/edges
  // without triggering re-renders or being limited to the displayed scope.
  const graphRef = useRef({ nodes, edges })
  graphRef.current = { nodes, edges }

  // Spatial index for fast edge proximity queries (R-tree)
  const spatialIndexRef = useRef<EdgeSpatialIndex | null>(null)

  // Update spatial index when nodes or edges change
  useEffect(() => {
    if (!spatialIndexRef.current) {
      spatialIndexRef.current = new EdgeSpatialIndex()
    }

    // Rebuild index if nodes/edges changed
    if (spatialIndexRef.current.needsRebuild(nodes, modelEdges)) {
      spatialIndexRef.current.build(nodes, modelEdges)
    }
  }, [nodes, modelEdges])
  const [showChatPanel, setShowChatPanel] = useState(false)
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>(undefined)
  const [showGitHistoryPanel, setShowGitHistoryPanel] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [parameterEditorState, setParameterEditorState] = useState<{
    open: boolean
    operatorId: string | null
  }>({ open: false, operatorId: null })
  const [paramEditorError, setParamEditorError] = useState<Error | null>(null)
  // Throw during render so the ErrorBoundary catches it with a descriptive message
  if (paramEditorError) throw paramEditorError

  // Auto-layout settings (declared early as they're used in multiple places)
  const [autoLayout, setAutoLayout] = useState<AutoLayoutSettings>(DEFAULT_AUTO_LAYOUT)

  // Wrap onNodesChange to track node selection and mark unsaved changes
  const onNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeBase>[0]) => {
      // Track selection changes
      const selectedChanges = changes.filter(change => change.type === 'select' && change.selected)
      if (selectedChanges.length > 0) {
        getUIStore().setInspectedReferenceEdge(null)
        analytics.track('node_selected', { count: selectedChanges.length })
      }

      // Mark as unsaved if there are user-initiated changes
      // (exclude 'select' and 'dimensions' - dimensions are fired when React Flow measures nodes)
      const hasUserChanges = changes.some(
        change => change.type !== 'select' && change.type !== 'dimensions'
      )
      if (hasUserChanges) {
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

  const contextLoadStarted = useRef(false)

  // Start loading AI context bundles when the chat panel is first opened
  useEffect(() => {
    if (showChatPanel && !contextLoadStarted.current) {
      contextLoadStarted.current = true
      globalContextManager.startLoading().catch(error => {
        debugApp('Failed to preload AI context:', error)
      })
    }
  }, [showChatPanel])

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    // Don't warn for examples - they're read-only demos
    const unsaved = !isExamplesRoute && (hasUnsavedChanges || storageType === 'memory')
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    const displayName =
      storageType === 'memory'
        ? memoryProjectStore.getDisplayName(projectName || '') || 'Untitled'
        : projectName
    document.title = displayName
      ? `Noodles.gl - ${displayName}${unsaved ? ' *' : ''}`
      : 'Noodles.gl'

    // A stale chunk after a deploy prompts instead of reloading while this guard is armed
    staleChunk.setUnsavedWork(unsaved)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      staleChunk.setUnsavedWork(false)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasUnsavedChanges, projectName, storageType, isExamplesRoute])

  // Only changes when graph structure changes (nodes added/removed/type changed, edges reconnected)
  // Intentionally excludes node position so dragging does NOT re-run transformGraph
  const graphStructureKey = useMemo(() => {
    const nodeIds = nodes
      .map(n => `${n.id}:${n.type}`)
      .sort()
      .join(',')
    const edgeIds = edges
      .map(e => e.id)
      .sort()
      .join(',')
    return `${nodeIds}|${edgeIds}`
  }, [nodes, edges])

  // Visual ForLoop groups are derived from the directed Begin-to-End subgraph. Re-run
  // when connectivity, membership, or measured dimensions change, but not during a drag.
  const forLoopLayoutKey = useMemo(() => {
    const nodeState = nodes
      .map(
        node =>
          `${node.id}:${node.type}:${node.parentId ?? ''}:${node.measured?.width ?? ''}x${node.measured?.height ?? ''}`
      )
      .sort()
      .join(',')
    const connectivity = modelEdges
      .map(edge => `${edge.source}->${edge.target}`)
      .sort()
      .join(',')
    return `${nodeState}|${connectivity}`
  }, [nodes, modelEdges])

  // nodes/edges are represented by forLoopLayoutKey; position-only updates intentionally
  // do not trigger this effect because drag-stop performs the fit once per gesture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional key-based reconciliation
  useEffect(() => {
    setNodes(currentNodes => reconcileForLoopGroups(currentNodes, modelEdges))
  }, [forLoopLayoutKey, setNodes])

  // `transformGraph` needs all nodes to build the opMap and resolve connections
  // Use useEffect instead of useMemo to avoid setState during render
  // Map identity only changes when an operator is added or removed, so position and
  // selection updates don't rebind the timeline
  const operatorsMap = useGraphStore(state => state.operators)
  const operators = useMemo(() => Array.from(operatorsMap.values()), [operatorsMap])
  // Set to true in loadProjectFile so the effect below skips the redundant re-run triggered
  // by setNodes/setEdges — the graph was already built synchronously during load
  const isProjectLoadRef = useRef(false)
  // nodes/edges omitted from deps intentionally — only re-run on structural changes, not position updates during drag
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - graphStructureKey gates this
  useEffect(() => {
    // loadProjectFile already called transformGraph directly, so skip this triggered re-run
    if (isProjectLoadRef.current) return
    const result = transformGraph({ nodes, edges })
    // Show error dialog if there are graph errors
    if (result.errors.length > 0) {
      setGraphErrors(
        result.errors.map(e => ({
          type: e.type,
          message: e.message,
        }))
      )
    }
    // Catch-all for multi-input slot caches: re-derive orderIndex/groupSize now that the
    // operators exist in the store (covers undo/redo restores, keyboard deletes, and AI/paste
    // paths that added edges before their operators were instantiated). Returns the same
    // array reference when nothing changed, so this doesn't loop.
    setEdges(currentEdges =>
      normalizeMultiInputEdges(currentEdges.filter(edge => edge.type !== 'ReferenceEdge'))
    )
  }, [graphStructureKey])

  // Reset isProjectLoadRef after every render so the flag never gets stuck when
  // graphStructureKey doesn't change (e.g. re-loading the same project, undo of position-only drag).
  // Defined after the graphStructureKey effect so it clears the flag after the guard check runs.
  useEffect(() => {
    isProjectLoadRef.current = false
  })

  // Bind timeline tracks for all operators (outside ReactFlow rendering pipeline).
  useEffect(() => {
    const newCleanupFns = new Map<string, () => void>()
    const currentOperatorIds = new Set(operators.map(op => op.id))

    for (const op of operators) {
      if (op.id === '/out') continue // Skip special operators
      const cleanup = bindOperatorToTimeline(op)
      if (cleanup) {
        newCleanupFns.set(op.id, cleanup)
      }
    }
    cleanupRemovedOperatorsNative(currentOperatorIds)

    return () => {
      for (const cleanup of newCleanupFns.values()) {
        cleanup()
      }
    }
  }, [operators])

  // Use shared hook for project modifications
  const {
    applyModifications,
    onConnect: onConnectBase,
    onReconnect: onReconnectBase,
    onNodesDelete: onNodesDeleteBase,
    updateOperatorId,
  } = useProjectModifications({
    getNodes: useCallback(() => nodes, [nodes]),
    getEdges: useCallback(() => edges, [edges]),
    setNodes,
    setEdges,
  })

  const currentContainerId = useNestingStore(state => state.currentContainerId)

  // Manual layout function - layouts selected nodes or all nodes in current container
  const applyManualLayout = useCallback(() => {
    // Get selected nodes in the current container
    const selectedNodes = nodes.filter(node => {
      if (!node.selected) return false
      const nodeParent = getParentPath(node.id)
      return currentContainerId === '/' ? nodeParent === '/' : nodeParent === currentContainerId
    })

    // If less than 2 nodes selected, use all nodes in container
    const targetNodes =
      selectedNodes.length >= 2
        ? selectedNodes
        : nodes.filter(node => {
            const nodeParent = getParentPath(node.id)
            return currentContainerId === '/'
              ? nodeParent === '/'
              : nodeParent === currentContainerId
          })

    if (targetNodes.length < 2) return

    // Get edges between these nodes
    const targetNodeIds = new Set(targetNodes.map(n => n.id))
    const targetEdges = edges.filter(
      e => targetNodeIds.has(e.source) && targetNodeIds.has(e.target)
    )

    // Apply layout
    const layoutedNodes = layoutNodes(targetNodes, targetEdges)

    // Track layout application
    analytics.track('layout_applied', {
      nodeCount: targetNodes.length,
      edgeCount: targetEdges.length,
      isManual: true,
      scope: selectedNodes.length >= 2 ? 'selection' : 'container',
    })

    // Update node positions
    setNodes(currentNodes =>
      currentNodes.map(node => {
        const layoutedNode = layoutedNodes.find(n => n.id === node.id)
        if (layoutedNode) {
          return {
            ...node,
            position: layoutedNode.position,
          }
        }
        return node
      })
    )

    // Fit view to show all nodes with animation
    setTimeout(() => {
      reactFlowInstanceRef.current?.fitView({
        duration: 300,
        padding: 0.2,
      })
    }, 0)
  }, [nodes, edges, currentContainerId, setNodes])

  // Auto-layout function for current container (used by onConnect trigger)
  const applyAutoLayoutToContainer = useCallback(() => {
    if (!autoLayout.enabled) return

    // Get all nodes in the current container
    const containerNodes = nodes.filter(node => {
      const nodeParent = getParentPath(node.id)
      return currentContainerId === '/' ? nodeParent === '/' : nodeParent === currentContainerId
    })

    if (containerNodes.length < 2) return

    // Get edges between these nodes
    const containerNodeIds = new Set(containerNodes.map(n => n.id))
    const containerEdges = edges.filter(
      e => containerNodeIds.has(e.source) && containerNodeIds.has(e.target)
    )

    // Apply layout
    const layoutedNodes = layoutNodes(containerNodes, containerEdges)

    // Track automatic layout application
    analytics.track('layout_applied', {
      nodeCount: containerNodes.length,
      edgeCount: containerEdges.length,
      isManual: false,
      scope: 'container',
    })

    // Update node positions
    setNodes(currentNodes =>
      currentNodes.map(node => {
        const layoutedNode = layoutedNodes.find(n => n.id === node.id)
        if (layoutedNode) {
          return {
            ...node,
            position: layoutedNode.position,
          }
        }
        return node
      })
    )

    // Fit view to show all nodes with animation
    setTimeout(() => {
      reactFlowInstanceRef.current?.fitView({
        duration: 300,
        padding: 0.2,
      })
    }, 0)
  }, [autoLayout, nodes, edges, currentContainerId, setNodes])

  // Keep the WebMCP tool surface in sync with editor state when external
  // control is enabled (?externalControl=true). The agent benchmark reads and
  // applies through the same bridge.
  useEffect(() => {
    if (!externalControl && !agentBench) return
    setModificationApplier(applyModifications)
    return () => setModificationApplier(null)
  }, [applyModifications])

  useEffect(() => {
    if (!externalControl && !agentBench) return
    // ReactFlow edges type sourceHandle as string | null; the project shape uses undefined
    setCurrentProject({ nodes, edges } as NoodlesProject)
  }, [nodes, edges])

  // Wrap onConnect to mark unsaved changes and trigger auto-layout if enabled
  const onConnect = useCallback(
    (connection: Connection) => {
      onConnectBase(connection)
      setHasUnsavedChanges(true)
      // Trigger auto-layout after the connection is established
      if (autoLayout.enabled) {
        // Use setTimeout to ensure the edge is added before layout is computed
        setTimeout(() => applyAutoLayoutToContainer(), 0)
      }
    },
    [onConnectBase, autoLayout.enabled, applyAutoLayoutToContainer]
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
      onReconnectBase(oldEdge, newConnection)
      setHasUnsavedChanges(true)
    },
    [onReconnectBase]
  )

  // Clear any leftover multi-input slot state when a reconnect drag is dropped or cancelled
  const onReconnectEnd = useCallback(() => {
    clearPendingInsertionIndex()
  }, [])

  const spreadsheetVisible = useUIStore(state => state.spreadsheetVisible)
  const setSpreadsheetVisible = useUIStore(state => state.setSpreadsheetVisible)

  // Track connection drag state for dimming unconnectable nodes
  const setConnectionDragState = useUIStore(state => state.setConnectionDragState)
  const connectionDragState = useUIStore(state => state.connectionDragState)
  const setTargetedEdge = useUIStore(state => state.setTargetedEdge)
  const onConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (!params.nodeId || !params.handleId) return

      const sourceOp = getOp(params.nodeId)
      if (!sourceOp) return

      // Parse handle ID to get namespace and field name (e.g., "out.data" -> ["out", "data"])
      const [namespace, fieldName] = params.handleId.split('.')
      if (!namespace || !fieldName) return

      // Determine the source field based on handle type
      const isOutput = params.handleType === 'source'
      const sourceField = isOutput ? sourceOp.outputs[fieldName] : sourceOp.inputs[fieldName]
      if (!sourceField) return

      // Calculate which nodes have compatible handles
      const compatibleNodeIds = new Set<string>()
      const store = getOpStore()

      for (const [nodeId, op] of store.operators) {
        if (nodeId === params.nodeId) continue

        // Check target handles (inputs if dragging from output, outputs if dragging from input)
        const targetFields = isOutput ? op.inputs : op.outputs
        for (const targetField of Object.values(targetFields)) {
          const compatible = isOutput
            ? canConnectCached(sourceField, targetField)
            : canConnectCached(targetField, sourceField)
          if (compatible) {
            compatibleNodeIds.add(nodeId)
            break
          }
        }
      }

      // Calculate which existing edges the dragged source is compatible with (computed once,
      // used to vary hit area size and highlight style during mousemove)
      const compatibleEdgeIds = new Set<string>()
      for (const edge of edges) {
        if (edge.type === 'ReferenceEdge') continue
        if (edge.source === params.nodeId || edge.target === params.nodeId) continue
        const targetHandleInfo = parseHandleId(edge.targetHandle || '')
        if (!targetHandleInfo) continue
        const targetOp = getOp(edge.target)
        if (!targetOp) continue
        const targetField = targetOp.inputs[targetHandleInfo.fieldName]
        if (!targetField) continue
        const compatible = isOutput
          ? canConnectCached(sourceField, targetField)
          : canConnectCached(targetField, sourceField)
        if (compatible) compatibleEdgeIds.add(edge.id)
      }

      setConnectionDragState({
        sourceNodeId: params.nodeId,
        sourceHandleId: params.handleId,
        compatibleNodeIds,
        compatibleEdgeIds,
      })
    },
    [setConnectionDragState, edges]
  )

  const { onConnectEnd: onConnectionDropEnd } = useConnectionDropOnEdge({
    getNodes: useCallback(() => nodes, [nodes]),
    getEdges: useCallback(() => edges, [edges]),
    onConnect,
    getConnectionDragState: () => useUIStore.getState().connectionDragState,
    screenToFlowPosition: pos => reactFlowInstanceRef.current?.screenToFlowPosition(pos) ?? pos,
  })

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      onConnectionDropEnd(event, connectionState)
      setConnectionDragState(null)
      setTargetedEdge(null)
      // Drop any multi-input slot state from a cancelled drag (successful connects
      // already consumed it in onConnect)
      clearPendingInsertionIndex()
    },
    [onConnectionDropEnd, setConnectionDragState, setTargetedEdge]
  )

  const onMouseMove = useCallback(
    (event: { clientX: number; clientY: number }) => {
      if (!connectionDragState) return
      const pos = reactFlowInstanceRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      if (!pos) return
      const edge = findEdgeAtPosition(
        pos,
        connectionDragState.sourceNodeId,
        () => graphRef.current.nodes,
        () => graphRef.current.edges,
        connectionDragState.compatibleEdgeIds,
        spatialIndexRef.current || undefined
      )
      setTargetedEdge(
        edge
          ? { id: edge.id, compatible: connectionDragState.compatibleEdgeIds.has(edge.id) }
          : null
      )
    },
    [connectionDragState, setTargetedEdge]
  )

  // Hook for dropping nodes onto edges to insert them
  const { onNodeDrag: onNodeDragBase, onNodeDragStop: onNodeDragStopBase } = useNodeDropOnEdge({
    getNodes: useCallback(() => graphRef.current.nodes, []),
    getEdges: useCallback(() => graphRef.current.edges, []),
    setEdges,
  })

  // Track node drag for visual feedback
  const onNodeDrag = useCallback(
    (event: React.MouseEvent, node: ReactFlowNode) => {
      onNodeDragBase(event, node)
    },
    [onNodeDragBase]
  )

  // Wrap onNodeDragStop to mark unsaved changes when a node is inserted
  const onNodeDragStop = useCallback(
    (event: React.MouseEvent, node: ReactFlowNode) => {
      const result = onNodeDragStopBase(event, node)
      setNodes(currentNodes =>
        reconcileForLoopGroups(currentNodes, [
          ...graphRef.current.edges,
          ...referenceDependencyModel.getSnapshot(),
        ])
      )
      // Mark as unsaved if a node was inserted into an edge
      if (result) {
        setHasUnsavedChanges(true)
      }
    },
    [onNodeDragStopBase, setNodes]
  )

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: ReactFlowNode<Record<string, unknown>>) => {
      event.preventDefault()
      const op = getOp(node.id)
      if (op && (op.constructor as typeof Operator).supportsCustomFields) {
        setParameterEditorState({ open: true, operatorId: node.id })
      }
    },
    []
  )
  const reactFlowRef = useRef<HTMLDivElement>(null)
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const blockLibraryRef = useRef<BlockLibraryRef>(null)

  // Avoid circular dependency
  const loadProjectFileRef =
    useRef<
      (
        project: NoodlesProjectJSON,
        name?: string,
        targetRoutePrefix?: string,
        outputCache?: OutputCache
      ) => void
    >()

  const currentProjectRef = useRef<NoodlesProjectJSON>(newProjectJSON)
  // Counts project loads, so the chat panel can tell its proposal's project was replaced
  const [projectLoadId, setProjectLoadId] = useState(0)
  // False while an undo/redo restore reloads the project, so the graph keeps its view
  const [fitViewOnLoad, setFitViewOnLoad] = useState(false)

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
    getUIStore().setInspectedReferenceEdge(null)
  }, [setNodes, setEdges])

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: ReactFlowEdge) => {
      analytics.track('edge_selected', { type: edge.type ?? 'default' })
      if (edge.type === 'ReferenceEdge') {
        onDeselectAll()
        getUIStore().setInspectedReferenceEdge(
          referenceEdges.find(referenceEdge => referenceEdge.id === edge.id) ?? edge
        )
      } else {
        getUIStore().setInspectedReferenceEdge(null)
      }
    },
    [onDeselectAll, referenceEdges]
  )

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

  // Handle 'v' keyup to create ViewerOp (momentary button behavior)
  useKeyboardShortcut('v', () => {
    const currentNodes = graphRef.current.nodes
    const hoveredHandle = getUIStore().hoveredOutputHandle
    let sourceNode: ReactFlowNode | undefined
    let sourceHandle: string | null = null

    // Priority 1: If hovering over ANY output handle, use that
    if (hoveredHandle?.handleId.startsWith('out.')) {
      sourceNode = currentNodes.find(node => node.id === hoveredHandle.nodeId)
      sourceHandle = sourceNode ? hoveredHandle.handleId : null
    }

    // Priority 2: If nodes are selected, use rightmost selected node
    if (!sourceNode) {
      const selectedNodes = currentNodes.filter(node => node.selected)
      if (selectedNodes.length === 0) return

      sourceNode = selectedNodes.reduce((rightmost, node) =>
        node.position.x > rightmost.position.x ? node : rightmost
      )
      const sourceOp = getOpStore().getOp(sourceNode.id)
      const firstOutputKey = sourceOp && Object.keys(sourceOp.outputs)[0]
      sourceHandle = firstOutputKey ? `out.${firstOutputKey}` : null
    }

    const viewerId = nodeId('viewer', currentContainerId)
    const viewerNode: AnyNodeJSON = {
      id: viewerId,
      type: 'ViewerOp',
      position: calculateViewerPosition(sourceNode, currentNodes),
      data: undefined,
    }

    setNodes(nodes => (nodes.some(node => node.id === viewerId) ? nodes : [...nodes, viewerNode]))

    if (sourceHandle) {
      const targetHandle = 'par.data'
      const newEdge: ReactFlowEdge = {
        id: edgeId({
          source: sourceNode.id,
          sourceHandle,
          target: viewerId,
          targetHandle,
        }),
        source: sourceNode.id,
        sourceHandle,
        target: viewerId,
        targetHandle,
      }
      setEdges(edges => normalizeMultiInputEdges(insertUniqueEdge(edges, newEdge)))
    }

    analytics.track('viewer_created', { method: 'keyboard' })
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

  // Handle Cmd+A / Ctrl+A to select all nodes in current container
  const selectAllNodes = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      analytics.track('select_all_nodes')

      setNodes(currentNodes =>
        currentNodes.map(node => {
          const nodeParent = getParentPath(node.id)
          const isInCurrentContainer =
            currentContainerId === '/' ? nodeParent === '/' : nodeParent === currentContainerId

          return {
            ...node,
            selected: isInCurrentContainer ? true : node.selected,
          }
        })
      )
      return false
    },
    [setNodes, currentContainerId]
  )

  // Register platform-specific shortcuts
  const isMac = useMemo(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0, [])
  useKeyboardShortcut(isMac ? 'cmd+a' : 'ctrl+a', selectAllNodes, [selectAllNodes])
  useKeyboardShortcut(isMac ? 'cmd+l' : 'ctrl+l', applyManualLayout, [applyManualLayout])

  const [showOverlay, setShowOverlay] = useState(true)
  const [showDebugInfo, setShowDebugInfo] = useState(false)

  // Render settings are now stored as OutOp inputs (see migration 012)
  // Use useRenderSettings() hook to read them

  const loadProjectFile = useCallback(
    (
      project: NoodlesProjectJSON,
      name?: string,
      targetRoutePrefix?: string,
      outputCache?: OutputCache
    ) => {
      // A load that resolves after the editor unmounted must not refill the shared store
      if (!isMountedRef.current) return
      const { nodes, edges, timeline, editorSettings, apiKeys } = project

      // Prevent the storage-loading useEffect from reloading when the URL changes below
      isProgrammaticLoadRef.current = true
      // Signal the graphStructureKey effect to skip — transformGraph runs synchronously below
      isProjectLoadRef.current = true

      currentProjectRef.current = project
      setProjectLoadId(id => id + 1)
      // An empty project has nothing to fit, and fitting once its first node appears
      // would jump the view
      setFitViewOnLoad(nodes.length > 0 && !undoRedoRef.current?.isRestoring())
      getUIStore().setStarterHintNodeId(null)

      // Install embedded keys before constructing operators. Key-dependent operators
      // may inspect credentials while their fields and listeners are initialized.
      const keysStore = getKeysStore()
      keysStore.setProjectKeys(apiKeys)

      // Dispose all old operators cleanly (executionState.complete() + unsubscribeListeners)
      const store = getOpStore()
      for (const op of store.getAllOps()) {
        op.dispose()
      }
      store.clearOps()

      // Load timeline state before transformGraph so field bindings see the right keyframe data
      clearAllBindings()
      const hasTimeline = timeline && Object.keys(timeline).length > 0
      const timelineErrors: GraphError[] = []
      if (hasTimeline) {
        try {
          // Timeline data uses a timeline JSON format.
          timelineStore.fromTimelineJSON(
            timeline as unknown as import('../timeline/types').TimelineData
          )
          expandTimelineIfAnimated()
        } catch (error) {
          console.error('Failed to load timeline:', error)
          timelineErrors.push({
            type: 'operator-execution',
            message: 'Failed to load timeline data',
            details: error instanceof Error ? error.stack : String(error),
          })
        }
      } else {
        timelineStore.reset()
      }

      // Build the operator graph synchronously — operators are ready before any re-render
      const result = transformGraph({ nodes, edges, outputCache })
      // Show error dialog if there are graph or timeline errors
      const allErrors = [
        ...timelineErrors,
        ...result.errors.map(e => ({
          type: e.type,
          message: e.message,
        })),
      ]
      if (allErrors.length > 0) {
        setGraphErrors(allErrors)
      }

      // Update React Flow state (for rendering; graph is already set up above).
      // Normalizing here (after transformGraph, so operators exist for the ListField
      // lookup) derives multi-input slot rendering caches from the file's edge order —
      // project files never store them. Nodes with a missing operator type render as the
      // UnknownOperator placeholder; serializeNodes saves them back with their original type.
      setNodes(markUnknownOperatorNodes(nodes))
      setEdges(
        normalizeMultiInputEdges(
          (edges as ReactFlowEdge[]).filter(edge => edge.type !== 'ReferenceEdge')
        )
      )

      // Load editor settings from project with defaults
      setShowOverlay(editorSettings?.showOverlay ?? true)
      setShowDebugInfo(editorSettings?.showDebugInfo ?? false)
      setAutoLayout({
        enabled: editorSettings?.autoLayout?.enabled ?? DEFAULT_AUTO_LAYOUT.enabled,
      })

      // Render settings are now stored as OutOp inputs (migration 012 handles conversion)

      // Navigate to the project URL
      const effectiveRoutePrefix = targetRoutePrefix ?? routePrefix
      navigate(name ? `${effectiveRoutePrefix}/${name}` : '/', { replace: true })

      setHasUnsavedChanges(false)
    },
    [setNodes, setEdges, navigate, routePrefix, timelineStore.fromTimelineJSON, timelineStore.reset]
  )

  // Assign to ref for undo/redo system
  loadProjectFileRef.current = loadProjectFile

  // Examples open with one layer selected, so the properties panel starts with controls
  const selectStarterNode = useCallback(
    (project: NoodlesProjectJSON) => {
      const starterId = findStarterNodeId(project, isLayerType)
      const starter = starterId ? project.nodes.find(node => node.id === starterId) : undefined
      if (!starter) return
      setNodes(nodes =>
        nodes.map(node =>
          node.id === starter.id
            ? { ...node, selected: true }
            : node.selected
              ? { ...node, selected: false }
              : node
        )
      )
      getUIStore().setStarterHintNodeId(starter.id)
      analytics.track('starter_node_selected', { operatorType: starter.type })
    },
    [setNodes]
  )

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
      if (!projectName) {
        try {
          loadProjectFile(newProjectJSON as NoodlesProjectJSON)
          return
        } catch (_error) {
          debugApp('Failed to load default new project:', _error)
        }
        return
      }

      // Handle /projects/new route - load new project into memory
      if (isNewProjectRoute) {
        const existingProject = memoryProjectStore.getProjectJson('new')
        if (existingProject) {
          const project = await migrateProject(existingProject)
          setCurrentDirectory(null, 'new')
          setActiveStorageType('memory')
          loadProjectFile(project, 'new')
        } else {
          const starter = { ...newProjectJSON, version: NOODLES_VERSION } as NoodlesProjectJSON
          memoryProjectStore.setProjectJson('new', starter)
          setCurrentDirectory(null, 'new')
          setActiveStorageType('memory')
          loadProjectFile(starter, 'new')
        }
        return
      }

      if (isExamplesRoute) {
        // For /examples route: check memory first, then load from bundled examples
        const existingInMemory = memoryProjectStore.getProjectJson(projectName)
        if (existingInMemory) {
          const project = await migrateProject(existingInMemory)
          const outputCache = await readMemoryOutputCache(projectName, project.nodes)
          setCurrentDirectory(null, projectName)
          setActiveStorageType('memory')
          loadProjectFile(project, projectName, undefined, outputCache)
          return
        }

        // Not in memory, load from static bundled examples and copy into memory for editing
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
            // Store in memory with example name as ID and set display name from project JSON
            memoryProjectStore.setProjectJson(projectName, project)
            if (project.name) {
              memoryProjectStore.setDisplayName(projectName, project.name)
            }
            await copyExampleAssetsToMemory(projectName, projectName)
            const outputCache = await readMemoryOutputCache(projectName, project.nodes)
            setCurrentDirectory(null, projectName)
            setActiveStorageType('memory')
            loadProjectFile(project, projectName, undefined, outputCache)
            if (
              claimStarterSelection({
                exampleId: projectName,
                fromBundledExample: true,
                agentControlled: externalControl || agentBench,
              })
            ) {
              selectStarterNode(project)
            }
            return
          } catch (error) {
            debugApp('Failed to load example project:', error)
          }
        }

        // Example not found - show dialog with navigation options
        setShowExampleNotFoundDialog(true)
      } else if (isProjectsRoute) {
        // For /projects route: ONLY load from user storage (OPFS or File System Access API)
        try {
          const result = await load(storageType, projectName)
          if (result.success) {
            const project = await migrateProject(result.data.projectData)
            // Update store with directory handle, project name, and storage type
            setCurrentDirectory(result.data.directoryHandle, projectName)
            setActiveStorageType(storageType)
            loadProjectFile(project, projectName, undefined, result.data.outputCache)
            analytics.track('project_opened', { storageType, source: 'url' })
          } else {
            const { type, directoryHandle } = result.error
            analytics.track('project_open_failed', {
              storageType,
              reason: openFailureReason(type),
              source: 'url',
            })
            if (type === 'not-found') {
              setProjectOpenProblem({ reason: 'not-found' })
            } else if (
              (type === 'permission-prompt' || type === 'permission-denied') &&
              directoryHandle
            ) {
              // A remembered folder whose permission the browser reset, e.g. after a restart
              setProjectOpenProblem({ reason: type, directoryHandle })
            } else {
              setError(result.error)
            }
          }
        } catch (error) {
          analytics.track('project_open_failed', {
            storageType,
            reason: 'migration_error',
            source: 'url',
          })
          setError({
            type: 'unknown',
            message: 'Error loading project',
            details: error instanceof Error ? error.message : 'Unknown error',
            originalError: error,
          })
        }
      }
    })()
  }, [projectName, isExamplesRoute, isNewProjectRoute, isProjectsRoute])

  // Handle pending quick start actions (file upload or LLM question from quick start modal)
  const pendingActionHandledRef = useRef(false)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const clearPendingImportFile = useCallback(() => setPendingImportFile(null), [])
  useEffect(() => {
    // Only run once after project is loaded (nodes are populated)
    if (nodes.length === 0 || pendingActionHandledRef.current) return

    const pendingAction = getPendingQuickStartAction()
    if (!pendingAction) return

    pendingActionHandledRef.current = true

    const plan = planQuickStartAction(pendingAction)
    if (!plan) return
    if (plan.importFile) setPendingImportFile(plan.importFile)
    if (plan.chatMessage) {
      setChatInitialMessage(plan.chatMessage)
      setShowChatPanel(true)
      trackChatOpened('quick_start')
    }
    analytics.track(plan.event, plan.mode ? { mode: plan.mode } : undefined)
  }, [nodes.length])

  const displayedNodes = useMemo(() => {
    const dragHandle = `.${s.dragHandle}`
    const targetContainerId = currentContainerId || '/'

    return nodes
      .filter(node => (getParentPath(node.id) ?? '/') === targetContainerId)
      .map(node => ({
        ...node,
        hidden: false,
        dragHandle,
        // Comments sit behind the nodes they overlap so they never block clicking them.
        // React Flow still raises a selected comment above the rest while it's edited.
        ...(node.type === 'CommentOp' ? { zIndex: -1 } : {}),
      }))
  }, [currentContainerId, nodes])

  const visibleNodeIds = useMemo(() => {
    return new Set(displayedNodes.map(node => node.id))
  }, [displayedNodes])

  const activeEdges = useMemo(() => {
    return modelEdges
      .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
      .map(edge => ({
        ...edge,
        sourceHandle: edge.type === 'ReferenceEdge' ? null : edge.sourceHandle,
      }))
  }, [modelEdges, visibleNodeIds])

  // File menu callbacks
  const getNoodlesProjectJson = useCallback((): NoodlesProjectJSON => {
    const store = getOpStore()
    const timeline = timelineStore.toTimelineJSON() as unknown as Record<string, unknown>
    const projectKeys = getKeysForProject()
    // Render settings are now stored as OutOp inputs, serialized with the node

    // Only include autoLayout if different from defaults
    const autoLayoutChanged = autoLayout.enabled !== DEFAULT_AUTO_LAYOUT.enabled
    // Kept so saving an example from the editor doesn't drop its starter node
    const startNode = currentProjectRef.current?.editorSettings?.startNode

    return {
      version: NOODLES_VERSION,
      nodes: serializeNodes(store, nodes, edges),
      edges: serializeEdges(store, nodes, edges),
      timeline,
      editorSettings: {
        showOverlay,
        ...(autoLayoutChanged ? { autoLayout } : {}),
        showDebugInfo,
        ...(startNode ? { startNode } : {}),
      },
      ...(projectKeys ? { apiKeys: projectKeys } : {}),
    }
  }, [nodes, edges, showOverlay, showDebugInfo, timelineStore.toTimelineJSON, autoLayout])

  // Files for the project's cache folder: the outputs of locked operators
  const getOutputCacheFiles = useCallback(() => serializeOutputCache(getOpStore(), nodes), [nodes])

  const onMenuSave = useCallback(async () => {
    if (!projectName) return
    const noodlesProjectJson = getNoodlesProjectJson()
    const cacheFiles = getOutputCacheFiles()

    if (storageType === 'memory') {
      try {
        const directoryHandle = await selectDirectory()
        const hasPermission = await requestPermission(directoryHandle, 'readwrite')
        if (!hasPermission) return

        const directoryName = directoryHandle.name
        await writeFileToDirectory(
          directoryHandle,
          'noodles.json',
          safeStringify(noodlesProjectJson)
        )
        await writeOutputCache(directoryHandle, cacheFiles)
        await copyMemoryDataToDirectory(projectName, directoryHandle)
        await directoryHandleCache.cacheHandle(directoryName, directoryHandle, directoryName)

        const oldProjectName = projectName
        setCurrentDirectory(directoryHandle, directoryName)
        setActiveStorageType('fileSystemAccess')
        navigate(`/projects/${directoryName}`, { replace: true })
        memoryProjectStore.deleteProject(oldProjectName)
        setHasUnsavedChanges(false)
        analytics.track('project_saved', { storageType: 'memory', promoted: true })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        setError({
          type: 'unknown',
          message: 'Error saving project',
          details: error instanceof Error ? error.message : 'Unknown error',
          originalError: error,
        })
      }
      return
    }

    const result = await save(storageType, projectName, noodlesProjectJson, cacheFiles)
    if (result.success) {
      setCurrentDirectory(result.data.directoryHandle, projectName)
      setHasUnsavedChanges(false)
      analytics.track('project_saved', { storageType })
    } else {
      setError(result.error)
    }
  }, [
    projectName,
    getNoodlesProjectJson,
    getOutputCacheFiles,
    storageType,
    setCurrentDirectory,
    setActiveStorageType,
    setError,
    navigate,
  ])

  // Autosave with debouncing. Reading the settings through the hook re-runs this effect when
  // version control or autosave is turned off, which cancels a pending save.
  const gitSettings = useGitSettings(projectName)
  useEffect(() => {
    if (!shouldAutosave({ settings: gitSettings, storageType, hasUnsavedChanges, isExamplesRoute }))
      return

    const timeoutId = setTimeout(() => {
      onMenuSave()
    }, gitSettings.autoCommitDelay)

    return () => clearTimeout(timeoutId)
  }, [gitSettings, storageType, hasUnsavedChanges, isExamplesRoute, onMenuSave])

  // Step 1 of Save As: Select directory and check conditions
  const onSaveAs = useCallback(async () => {
    try {
      // Prompt user to select/create a directory for the project
      const directoryHandle = await selectDirectory()

      // Ensure we have write permission
      const hasPermission = await requestPermission(directoryHandle, 'readwrite')
      if (!hasPermission) {
        debugApp('Permission denied to write to directory')
        return
      }

      // Check if target has existing noodles.json
      const hasExisting = await fileExists(directoryHandle, 'noodles.json')

      // Check if source has data files
      const hasData = projectName ? await hasDataDirectory(storageType, projectName) : false

      // Show dialog with options
      setSaveAsOptions({
        targetHandle: directoryHandle,
        hasExistingProject: hasExisting,
        hasDataFiles: hasData,
      })
      setShowSaveAsDialog(true)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the picker
        return
      }
      debugApp('Failed to open directory picker:', error)
      setError({
        type: 'unknown',
        message: 'Error selecting directory',
        details: error instanceof Error ? error.message : 'Unknown error',
        originalError: error,
      })
    }
  }, [storageType, projectName, setError])

  // Step 2 of Save As: Actually perform the save
  const onSaveAsConfirm = useCallback(
    async (options: { copyDataFiles: boolean }) => {
      if (!saveAsOptions?.targetHandle) return

      const directoryHandle = saveAsOptions.targetHandle
      const directoryName = directoryHandle.name

      // Get current project data
      const projectData = getNoodlesProjectJson()

      // Write project to noodles.json
      await writeFileToDirectory(directoryHandle, 'noodles.json', safeStringify(projectData))
      await writeOutputCache(directoryHandle, getOutputCacheFiles())

      // Copy data files if requested
      if (options.copyDataFiles && projectName) {
        if (storageType === 'memory') {
          await copyMemoryDataToDirectory(projectName, directoryHandle)
        } else if (storageType === 'publicFolder') {
          await copyPublicFolderData(projectName, directoryHandle)
        } else if (currentDirectory) {
          await copyDataDirectory(currentDirectory, directoryHandle)
        }
      }

      // Clean up memory project if promoting from memory
      if (storageType === 'memory') {
        memoryProjectStore.deleteProject(projectName!)
      }

      // Cache the directory handle
      await directoryHandleCache.cacheHandle(directoryName, directoryHandle, directoryHandle.name)

      // Update store with directory handle
      setCurrentDirectory(directoryHandle, directoryName)

      // Update storage type to fileSystemAccess since we used File System Access API
      setActiveStorageType('fileSystemAccess')

      // Update the URL to reflect the new project name
      navigate(`/projects/${directoryName}`, { replace: true })

      // Mark as saved
      setHasUnsavedChanges(false)

      analytics.track('project_saved_as', {
        fromStorageType: storageType,
        toStorageType: 'fileSystemAccess',
        copyDataFiles: options.copyDataFiles,
        overwroteExisting: saveAsOptions.hasExistingProject,
      })
    },
    [
      saveAsOptions,
      getNoodlesProjectJson,
      getOutputCacheFiles,
      projectName,
      storageType,
      currentDirectory,
      setCurrentDirectory,
      setActiveStorageType,
      navigate,
    ]
  )

  // Open rename dialog
  const onRename = useCallback(() => {
    if (!projectName || storageType === 'publicFolder' || storageType === 'memory') return
    setShowRenameDialog(true)
  }, [projectName, storageType])

  // Perform rename (copy to new location with new name)
  const onRenameConfirm = useCallback(
    async (newName: string) => {
      try {
        // Prompt user to select/create a directory with the new name
        const directoryHandle = await selectDirectory()

        // Verify the directory name matches what user entered (case-insensitive for macOS/Windows)
        if (directoryHandle.name.toLowerCase() !== newName.toLowerCase()) {
          throw new Error(
            `Selected folder name "${directoryHandle.name}" does not match the entered name "${newName}". Please select or create a folder with the name "${newName}".`
          )
        }

        // Ensure we have write permission
        const hasPermission = await requestPermission(directoryHandle, 'readwrite')
        if (!hasPermission) {
          throw new Error('Permission denied to write to directory')
        }

        // Get current project data
        const projectData = getNoodlesProjectJson()

        // Write project to noodles.json
        await writeFileToDirectory(directoryHandle, 'noodles.json', safeStringify(projectData))
        await writeOutputCache(directoryHandle, getOutputCacheFiles())

        // Copy data files
        if (currentDirectory) {
          await copyDataDirectory(currentDirectory, directoryHandle)
        }

        // Update cache: remove old, add new
        if (projectName) {
          await directoryHandleCache.renameProject(projectName, newName, directoryHandle)
        } else {
          await directoryHandleCache.cacheHandle(newName, directoryHandle, directoryHandle.name)
        }

        // Update store with directory handle
        setCurrentDirectory(directoryHandle, newName)

        // Update storage type to fileSystemAccess since we used File System Access API
        setActiveStorageType('fileSystemAccess')

        // Update the URL to reflect the new project name
        navigate(`/projects/${newName}`, { replace: true })

        // Mark as saved
        setHasUnsavedChanges(false)

        analytics.track('project_renamed', {
          fromStorageType: storageType,
          toStorageType: 'fileSystemAccess',
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // User cancelled the picker - throw to keep dialog open
          throw new Error('Directory selection was cancelled')
        }
        throw error // Re-throw to be handled by the dialog
      }
    },
    [
      getNoodlesProjectJson,
      getOutputCacheFiles,
      projectName,
      storageType,
      currentDirectory,
      setCurrentDirectory,
      setActiveStorageType,
      navigate,
    ]
  )

  // Handle mod+shift+s for Save As and mod+shift+a for Rename Project
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldBlockKeyboardShortcut(e)) return

      const key = e.key.toLowerCase()
      const isMod = e.metaKey || e.ctrlKey
      const isShift = e.shiftKey

      // mod+shift+s for Save As
      if (isMod && isShift && key === 's') {
        e.preventDefault()
        onSaveAs()
      }
      // mod+shift+a for Rename Project
      if (isMod && isShift && key === 'a') {
        e.preventDefault()
        if (projectName && storageType !== 'publicFolder' && storageType !== 'memory') {
          setShowRenameDialog(true)
        }
      }
      // mod+shift+h for Git History
      if (isMod && isShift && key === 'h') {
        e.preventDefault()
        if (supportsVersioning(storageType)) {
          setShowGitHistoryPanel(prev => !prev)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [projectName, storageType, onSaveAs])

  const onDownload = useCallback(async () => {
    const noodlesProjectJson = getNoodlesProjectJson()
    await saveProjectLocally(
      projectName || 'untitled',
      noodlesProjectJson,
      storageType,
      getOutputCacheFiles()
    )
    analytics.track('project_exported', { storageType })
  }, [projectName, getNoodlesProjectJson, getOutputCacheFiles, storageType])

  const onOpenAddNode = useCallback(() => {
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return
    const centerX = pane.left + pane.width / 2
    const centerY = pane.top + pane.height / 2
    blockLibraryRef.current?.openModal(centerX, centerY)
  }, [])

  // Layout callback for UI button (wraps applyManualLayout with analytics)
  const onAutoLayout = useCallback(() => {
    const selectedNodes = nodes.filter(n => n.selected)
    if (selectedNodes.length < 2) return

    analytics.track('auto_layout_applied', {
      nodeCount: selectedNodes.length,
      trigger: 'manual_button',
    })

    applyManualLayout()
  }, [nodes, applyManualLayout])

  const onChangeAutoLayoutOnConnect = useCallback((enabled: boolean) => {
    setAutoLayout(prev => ({ ...prev, enabled }))
    analytics.track('auto_layout_toggled', { enabled })
  }, [])

  // Note: Auto-layout on node addition was removed based on PR feedback.
  // Users can still trigger layout manually via the Layout button in the property panel (3+ nodes selected).
  // Auto-layout still triggers on edge creation when enabled (see onConnect handler above).

  const createMemoryProject = useCallback(
    (project: NoodlesProjectJSON, method: 'new' | 'createFromSQL') => {
      memoryProjectStore.setProjectJson('new', project)

      setCurrentDirectory(null, 'new')
      setActiveStorageType('memory')
      loadProjectFile(project, 'new', '/projects')

      analytics.track('project_created', { method })
    },
    [setCurrentDirectory, setActiveStorageType, loadProjectFile]
  )

  const onNewProject = useCallback(async () => {
    const starterProject = { ...newProjectJSON, version: NOODLES_VERSION } as NoodlesProjectJSON
    createMemoryProject(starterProject, 'new')
  }, [createMemoryProject])

  const onConfirmCreateFromSQL = useCallback(
    (sql: string) => {
      setPendingCreateFromSQL(null)
      createMemoryProject(createProjectFromSQL({ sql }), 'createFromSQL')
    },
    [createMemoryProject]
  )

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
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(await file.arrayBuffer())

        // Find the shallowest noodles.json in the ZIP (could be at root or in a subfolder)
        // We want the project root, not a noodles.json that might be in a data subfolder
        let noodlesJsonPath: string | null = null
        let projectFolder = ''

        // Iterate over files in the ZIP to find the shallowest noodles.json
        zip.forEach((relativePath, zipEntry) => {
          if (relativePath.endsWith('noodles.json') && !zipEntry.dir) {
            // Extract the folder path (everything before noodles.json)
            const folder = relativePath.substring(0, relativePath.lastIndexOf('noodles.json'))
            // Keep this one if it's the first found, or if it's shallower (fewer path segments)
            const currentDepth = noodlesJsonPath
              ? projectFolder.split('/').filter(Boolean).length
              : Infinity
            const newDepth = folder.split('/').filter(Boolean).length
            if (newDepth < currentDepth) {
              noodlesJsonPath = relativePath
              projectFolder = folder
            }
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

      // Load imported project into memory (user can save to disk later via Cmd+S)
      const draftId = generateDraftId('import')
      memoryProjectStore.setProjectJson(draftId, projectData)

      // Write non-noodles.json files as in-memory assets, keeping the cache folder apart
      const cachePrefix = `${CACHE_DIRECTORY_NAME}/`
      for (const [path, content] of filesToWrite.entries()) {
        if (path === 'noodles.json') continue
        if (path.startsWith(cachePrefix) && typeof content === 'string') {
          memoryProjectStore.setCacheFile(draftId, path.substring(cachePrefix.length), content)
          continue
        }
        const blob = content instanceof ArrayBuffer ? new Blob([content]) : new Blob([content])
        memoryProjectStore.writeAsset(draftId, path, blob)
      }

      const outputCache = await readMemoryOutputCache(draftId, projectData.nodes)
      setCurrentDirectory(null, draftId)
      setActiveStorageType('memory')
      loadProjectFile(projectData, draftId, '/projects', outputCache)

      analytics.track('project_imported', { format: isZip ? 'zip' : 'json' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the picker
        return
      }
      debugApp('Failed to import project:', error)
    }
  }, [setCurrentDirectory, setActiveStorageType, loadProjectFile])

  // Handlers for ExampleNotFoundDialog
  const onBrowseExamples = useCallback(() => {
    setShowExampleNotFoundDialog(false)
    navigate('/examples')
  }, [navigate])

  const onCheckMyProjects = useCallback(() => {
    setShowExampleNotFoundDialog(false)
    if (projectName) {
      navigate(`/projects/${projectName}`)
    }
  }, [navigate, projectName])

  const onOpen = useCallback(
    async (projectName?: string) => {
      try {
        let result: Awaited<ReturnType<typeof load>>
        let finalProjectName: string

        if (projectName) {
          // Load project by name (for recent projects)
          // Recent projects from directoryHandleCache are always fileSystemAccess
          finalProjectName = projectName
          result = await load('fileSystemAccess', projectName)
        } else {
          // Show the native folder picker (File System Access API)
          const projectDirectory = await selectDirectory()
          finalProjectName = projectDirectory.name

          // Cache the directory handle
          await directoryHandleCache.cacheHandle(
            finalProjectName,
            projectDirectory,
            projectDirectory.name
          )

          // Load project from the selected directory
          result = await load('fileSystemAccess', projectDirectory)
        }

        if (result.success) {
          const project = await migrateProject(result.data.projectData)
          // Always navigate to /projects since this is a user project
          loadProjectFile(project, finalProjectName, '/projects', result.data.outputCache)
          // Update store with directory handle returned from load
          setCurrentDirectory(result.data.directoryHandle, finalProjectName)
          // Set storage type to fileSystemAccess since we used File System Access API
          setActiveStorageType('fileSystemAccess')
          analytics.track('project_opened', { storageType: 'fileSystemAccess' })
        } else {
          setError(result.error)
          analytics.track('project_open_failed', {
            storageType: 'fileSystemAccess',
            error: 'load_error',
          })
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // User cancelled the picker
          return
        }
        debugApp('Failed to open project:', error)
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
          storageType: 'fileSystemAccess',
          error: projectName ? 'migration_error' : 'unknown',
        })
      }
    },
    [loadProjectFile, setCurrentDirectory, setActiveStorageType, setError]
  )

  const flowGraph = (
    <ErrorBoundary
      onUndo={() => {
        const before = getLastCommittedBeforeState()
        if (before != null) applyOperatorInputs(before)
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas wrapper needs mouse tracking */}
      <div
        className={cx('react-flow-wrapper', !showOverlay && 'react-flow-wrapper-hidden')}
        onMouseMove={onMouseMove}
      >
        <PrimeReactProvider>
          <TimelineProvider>
            <ProjectModificationActionsProvider updateOperatorId={updateOperatorId}>
              <ReactFlow
                ref={reactFlowRef}
                nodes={displayedNodes}
                edges={activeEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onReconnect={onReconnect}
                onReconnectEnd={onReconnectEnd}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeClick={onEdgeClick}
                onNodesDelete={onNodesDelete}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onPaneContextMenu={onPaneContextMenu}
                onPaneClick={onPaneClick}
                minZoom={0.2}
                fitViewOptions={fitViewOptions}
                defaultEdgeOptions={defaultEdgeOptions}
                nodeTypes={nodeComponents}
                edgeTypes={edgeComponents}
              >
                <ReactFlowInstanceCapture />
                <ProjectLoadView loadId={projectLoadId} fitView={fitViewOnLoad} />
                <MapPickFocus />
                <EdgeConnectionSynchronizer />
                <CanvasDropImport
                  pendingFile={pendingImportFile}
                  onPendingFileHandled={clearPendingImportFile}
                />
                <Background />
                <Controls position="bottom-right">
                  <CanvasQuickstartButton />
                </Controls>
                <CanvasQuickstart />
                <BlockLibrary ref={blockLibraryRef} reactFlowRef={reactFlowRef} />
                <CopyControls ref={copyControlsRef} graphRef={graphRef} />
                <UndoRedoHandler ref={undoRedoRef} graphRef={graphRef} />
                {showDebugInfo && <NodeInfoOverlay />}
                {showDebugInfo && <ViewportInfoPanel />}
              </ReactFlow>
            </ProjectModificationActionsProvider>
          </TimelineProvider>
        </PrimeReactProvider>
        {parameterEditorState.operatorId && (
          <ParameterEditorDialog
            open={parameterEditorState.open}
            onOpenChange={open => {
              setParameterEditorState({ open, operatorId: null })
              if (!open) setParamEditorError(null)
            }}
            operator={getOp(parameterEditorState.operatorId)!}
            onSave={definitions => {
              debugParams(
                'onSave for op %s, %d definitions',
                parameterEditorState.operatorId,
                definitions.length
              )
              const op = getOp(parameterEditorState.operatorId!)
              if (op) {
                try {
                  op.customInputDefinitions = definitions
                  debugParams('calling rebuildInputs on %s', op.id)
                  op.rebuildInputs()
                  debugParams('rebuildInputs complete, forcing re-render')
                  setNodes(nodes => [...nodes]) // Force re-render
                } catch (err) {
                  debugParams('rebuildInputs threw: %O', err)
                  setParamEditorError(err instanceof Error ? err : new Error(String(err)))
                }
              }
            }}
          />
        )}
        <ProjectNotFoundDialog
          projectName={projectName || ''}
          open={projectOpenProblem !== null}
          reason={projectOpenProblem?.reason}
          directoryHandle={projectOpenProblem?.directoryHandle}
          onProjectLoaded={(project, name, outputCache) => {
            // Always navigate to /projects since this is a user project
            loadProjectFile(project, name, '/projects', outputCache)
            setProjectOpenProblem(null)
          }}
          onNewProject={onNewProject}
          onImport={onImport}
          onClose={() => setProjectOpenProblem(null)}
        />
        <SaveAsDialog
          open={showSaveAsDialog}
          onClose={() => {
            setShowSaveAsDialog(false)
            setSaveAsOptions(null)
          }}
          onConfirm={onSaveAsConfirm}
          targetDirectoryName={saveAsOptions?.targetHandle?.name || ''}
          hasExistingProject={saveAsOptions?.hasExistingProject || false}
          hasDataFiles={saveAsOptions?.hasDataFiles || false}
        />
        <RenameDialog
          open={showRenameDialog}
          onClose={() => setShowRenameDialog(false)}
          onConfirm={onRenameConfirm}
          currentName={projectName || ''}
        />
        <ExampleNotFoundDialog
          projectName={projectName || ''}
          open={showExampleNotFoundDialog}
          onBrowseExamples={onBrowseExamples}
          onCheckMyProjects={onCheckMyProjects}
          onClose={() => setShowExampleNotFoundDialog(false)}
        />
        <CreateFromSQLDialog
          sql={pendingCreateFromSQL}
          onConfirm={onConfirmCreateFromSQL}
          onClose={() => setPendingCreateFromSQL(null)}
        />
        <GraphErrorDialog
          open={graphErrors.length > 0}
          errors={graphErrors}
          onClose={() => setGraphErrors([])}
          validOperatorCount={operators.length}
        />
        <StorageErrorHandler />
      </div>
    </ErrorBoundary>
  )

  // Assume there's always one 'out' op.
  const OUT_OP_ID = '/out'
  const outOp = operators.find(n => n.id === OUT_OP_ID)! as unknown as OutOp

  // Find the DeckRendererOp that connects to OutOp
  // Subscribe to its output instead of OutOp's input to create active subscription chain
  const deckRendererOp = useMemo(() => {
    const visConnection = edges.find(e => e.target === OUT_OP_ID && e.targetHandle === 'par.vis')
    if (visConnection) {
      return operators.find(op => op.id === visConnection.source) as DeckRendererOp | undefined
    }
    return undefined
  }, [operators, edges])

  const [visProps, setVisProps] = useState(
    deckRendererOp?.outputs.vis.value || outOp?.inputs.vis.value || {}
  )
  const deckProjectAssetResolver = useMemo(() => new DeckProjectAssetResolver(), [])
  const [committedAssetGeneration, setCommittedAssetGeneration] = useState(0)

  useEffect(
    () => () => {
      deckProjectAssetResolver.dispose()
    },
    [deckProjectAssetResolver]
  )

  useEffect(() => {
    // Deck.gl has received the replacement props by the time this effect runs.
    deckProjectAssetResolver.releaseRetiredUrlsThrough(committedAssetGeneration)
  }, [committedAssetGeneration, deckProjectAssetResolver])

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
    // Subscribe to DeckRendererOp output if available, otherwise fall back to OutOp input
    // DeckRendererOp creates active subscription chain, but may not be available during initial render
    const field = deckRendererOp?.outputs.vis || outOp?.inputs.vis

    if (field) {
      debugVis(
        'Creating vis subscription from %s',
        deckRendererOp ? 'DeckRendererOp.outputs.vis' : 'OutOp.inputs.vis'
      )
      let cancelled = false
      const reportMaterializationError = (error: unknown) => {
        if (cancelled) return
        console.error('[Noodles] Failed to materialize Deck.gl layer assets:', error)
        debugVis('Failed to materialize Deck.gl layer assets: %o', error)
      }
      const visSub = field.subscribe(
        ({ deckProps: { layers, widgets, views, ...deckProps }, mapProps }) => {
          void deckProjectAssetResolver
            .resolveLayers(layers ?? [], {
              activeStorageType: storageType,
              currentProjectName: storedProjectName,
            })
            .then(assetResolution => {
              if (!assetResolution || cancelled) {
                if (assetResolution) deckProjectAssetResolver.discard(assetResolution)
                return
              }

              try {
                // Map layers from POJOs to deck.gl instances
                const instantiatedLayers = assetResolution.layers.map(
                  ({ type, extensions, ...layer }) => {
                    // Instantiate extensions from POJOs if present
                    let instantiatedExtensions: LayerExtension[] | undefined
                    if (extensions && Array.isArray(extensions)) {
                      instantiatedExtensions = extensions
                        .map(ext => {
                          const instance = instantiateExtension(ext)
                          if (!instance) debugApp('Unknown extension type: %o', ext)
                          return instance
                        })
                        .filter((e): e is LayerExtension => e !== null)
                    }

                    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: We intentionally support all deck.gl layer types dynamically
                    return new deck[type]({
                      // Click-to-edit picks features, so layers that don't say otherwise
                      // are pickable in the editor. The node's output is unchanged.
                      ...(EDITOR_PICKING ? { pickable: true } : {}),
                      ...layer,
                      ...(instantiatedExtensions ? { extensions: instantiatedExtensions } : {}),
                      // Prevent deck.gl layer errors from crashing the GPU process
                      onError: (e: Error) => {
                        console.error(`[Noodles] Layer error in ${layer.id} (${type}):`, e)
                        debugVis('Layer error in %s (id=%s): %o', type, layer.id, e)
                      },
                    })
                  }
                )

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

                const instantiatedViews = views?.map(instantiateDeckView)

                debugVis(
                  'vis subscription fired: %d layers types=%O hasMapProps=%s',
                  instantiatedLayers.length,
                  assetResolution.layers.map(l => l.type),
                  !!mapProps
                )

                const nextVisProps = {
                  deckProps: {
                    ...deckProps,
                    layers: instantiatedLayers,
                    widgets: widgets?.map(({ type, ...widget }) => {
                      if (type === 'LegendWidget')
                        return new LegendWidget(widget as unknown as LegendWidgetProps)
                      if (type === 'BitmapOverlay')
                        return new BitmapOverlayWidget(
                          widget as unknown as BitmapOverlayWidgetProps
                        )
                      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: We intentionally support all deck.gl widget types dynamically
                      return new deckWidgets[type](widget)
                    }),
                    ...(instantiatedViews?.length ? { views: instantiatedViews } : {}),
                  },
                  mapProps,
                }

                if (!deckProjectAssetResolver.commit(assetResolution)) return
                setCommittedAssetGeneration(assetResolution.generation)
                setVisProps(nextVisProps)
              } catch (error) {
                deckProjectAssetResolver.discard(assetResolution)
                reportMaterializationError(error)
              }
            })
            .catch(reportMaterializationError)
        }
      )
      return () => {
        debugVis('Cleaning up vis subscription')
        cancelled = true
        visSub.unsubscribe()
        deckProjectAssetResolver.cancelPending()
      }
    }
  }, [
    deckProjectAssetResolver,
    deckRendererOp,
    outOp,
    selectedGeoJsonFeatures,
    storageType,
    storedProjectName,
  ])

  const propertiesPanel = (
    <ErrorBoundary title="Property Panel Error">
      <div className={s.rightPanel}>
        <PropertyPanel onAutoLayout={onAutoLayout} />
      </div>
    </ErrorBoundary>
  )

  const chatPanel = (
    <Suspense fallback={null}>
      <ChatPanel
        project={{ nodes, edges }}
        projectKey={projectLoadId}
        onClose={() => {
          trackChatClosed('panel')
          setShowChatPanel(false)
          setChatInitialMessage(undefined)
        }}
        isVisible={showChatPanel}
        initialMessage={chatInitialMessage}
      />
    </Suspense>
  )

  const gitHistoryPanel = showGitHistoryPanel && (
    <Suspense fallback={null}>
      <GitHistoryPanel
        projectDirectory={currentDirectory}
        projectName={projectName}
        onClose={() => setShowGitHistoryPanel(false)}
      />
    </Suspense>
  )

  return {
    flowGraph,
    selectedNodeIds: nodes.filter(n => n.selected).map(n => n.id),
    edges,
    nodeSidebar: (
      <ErrorBoundary title="Sidebar Error">
        <SidebarTabs
          tabs={[
            {
              id: 'nodes',
              label: 'Nodes',
              icon: 'pi-sitemap',
              content: <NodeTreeSidebar updateOperatorId={updateOperatorId} />,
            },
            {
              id: 'layers',
              label: 'Layers',
              icon: 'pi-clone',
              content: <LayerPanel />,
            },
          ]}
        />
      </ErrorBoundary>
    ),
    propertiesPanel,
    chatPanel,
    gitHistoryPanel,
    showOverlay,
    onChangeShowOverlay: setShowOverlay,
    showDebugInfo,
    onChangeShowDebugInfo: setShowDebugInfo,
    autoLayoutOnConnect: autoLayout.enabled,
    onChangeAutoLayoutOnConnect,
    spreadsheetVisible,
    onChangeSpreadsheetVisible: setSpreadsheetVisible,
    // Render settings are now read from OutOp via useRenderSettings() hook
    // Export these so timeline-editor can create the menu with render actions
    projectName:
      storageType === 'memory'
        ? memoryProjectStore.getDisplayName(projectName || '') || null
        : projectName,
    // The project whose version control settings the settings dialog edits
    versionedProjectName: supportsVersioning(storageType) ? projectName : null,
    getTimelineJson,
    onSaveProject: onMenuSave,
    onSaveAs,
    onRename: storageType !== 'publicFolder' && storageType !== 'memory' ? onRename : undefined,
    onDownload,
    onNewProject,
    onImport,
    onOpen,
    onOpenAddNode,
    undoRedoRef,
    copyControlsRef,
    reactFlowRef,
    showChatPanel,
    onChangeShowChatPanel: setShowChatPanel,
    hasUnsavedChanges,
    ...visProps,
  }
}
