import type { AnyNodeJSON } from 'SKIP-@xyflow/react'
import * as deckWidgets from '@deck.gl/widgets'
import { getProject, type IProjectConfig, types } from '@theatre/core'
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
  reconnectEdge,
  useEdgesState,
  useKeyPress,
  useNodesState,
} from '@xyflow/react'
import cx from 'classnames'
import type { LayerExtension } from 'deck.gl'
import * as deck from 'deck.gl'
import { PrimeReactProvider } from 'primereact/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'

import '@deck.gl/widgets/stylesheet.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'
import '@xyflow/react/dist/style.css'
import 'primereact/resources/themes/md-dark-indigo/theme.css'
import 'primeicons/primeicons.css'

import newProjectJSON from './new.json'
import { ChatPanel } from '../ai-chat/chat-panel'
import { globalContextManager } from '../ai-chat/global-context-manager'
import { analytics } from '../utils/analytics'

// Pre-load all example noodles.json files at build time
const exampleProjects = import.meta.glob('../examples/**/noodles.json', {
  eager: true,
  import: 'default',
})
import { SheetProvider } from '../utils/sheet-context'
import useSheetValue from '../utils/use-sheet-value'
import type { Visualization } from '../visualizations'
import { BlockLibrary, type BlockLibraryRef } from './components/block-library'
import { Breadcrumbs } from './components/breadcrumbs'
import { categories } from './components/categories'
import { CopyControls } from './components/copy-controls'
import { DropTarget } from './components/drop-target'
import { ErrorBoundary } from './components/error-boundary'
import { NoodlesMenubar } from './components/menu'
import { PropertyPanel } from './components/node-properties'
import { edgeComponents, nodeComponents } from './components/op-components'
import {
  ProjectNameBar,
  UNSAVED_PROJECT_NAME,
} from './components/project-name-bar'
import { ProjectNotFoundDialog } from './components/project-not-found-dialog'
import { StorageErrorHandler } from './components/storage-error-handler'
import {
  UndoRedoHandler,
  type UndoRedoHandlerRef,
} from './components/UndoRedoHandler'
import { useActiveStorageType, useFileSystemStore } from './filesystem-store'
import { IS_PROD } from './globals'
import { useProjectModifications } from './hooks/use-project-modifications'
import s from './noodles.module.css'
import type { IOperator, Operator, OutOp } from './operators'
import { extensionMap } from './operators'
import { load } from './storage'
import { getOpStore, useNestingStore } from './store'
import { bindOperatorToTheatre, cleanupRemovedOperators } from './theatre-bindings'
import { transformGraph } from './transform-graph'
import { edgeId, nodeId } from './utils/id-utils'
import { migrateProject } from './utils/migrate-schema'
import { getParentPath } from './utils/path-utils'
import { pick } from './utils/pick'
import { EMPTY_PROJECT, type NoodlesProjectJSON } from './utils/serialization'

export type Edge<N1 extends Operator<IOperator>, N2 extends Operator<IOperator>> = {
  id: `${N1['id']}.${'par'|'out'}.${keyof N1['outputs']}->${N2['id']}.${'par'|'out'}.${keyof N2['inputs']}`
  source: N1['id']
  target: N2['id']
  sourceHandle: `${'par'|'out'}.${keyof N1['outputs']}`
  targetHandle: `${'par'|'out'}.${keyof N2['inputs']}`
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
  const theatreSheet = useMemo(
    () => theatreProject.sheet(THEATRE_SHEET_ID),
    [theatreProject],
  )
  useEffect(() => {
    theatreProject?.ready.then(() => setTheatreReady(true))
  }, [theatreProject])

  const setTheatreProject = useCallback(
    (theatreConfig: IProjectConfig, incomingProjectName?: string) => {
      // Theatre stores too much state if you don't reset it properly.
      // We need to detach special objects (editor, render) before forgetting the sheet.

      // Detach the special Theatre objects that persist across the app
      theatreSheet.detachObject('editor')
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
    [theatreSheet],
  )

  const getTimelineJson = useCallback(() => {
    const timeline = studio.createContentOfSaveFile(theatreState.name)

    // Clear staticOverrides to prevent them from being saved, only preserve editor and render
    // objects since we're storing that state in Theatre
    const sheetsById = Object.fromEntries(
      Object.entries(
        timeline.sheetsById as Record<
          string,
          { staticOverrides?: { byObject?: unknown } }
        >,
      ).map(([sheetId, sheet]) => [
        sheetId,
        {
          ...sheet,
          staticOverrides: {
            byObject: pick(sheet.staticOverrides?.byObject || {}, [
              'editor',
              'render',
            ]),
          },
        },
      ]),
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
  const [, navigate] = useLocation()
  const params = useParams()

  // Get projectId from route params (/examples/:projectId) - router is single source of truth
  const projectName = params.projectId

  const [showProjectNotFoundDialog, setShowProjectNotFoundDialog] = useState(false)
  const storageType = useActiveStorageType()
  const { setCurrentDirectory, setActiveStorageType, setError } = useFileSystemStore()
  const { theatreReady, theatreProject, theatreSheet, setTheatreProject, getTimelineJson } =
    useTheatreJs(projectName)
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<AnyNodeJSON>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<ReactFlowEdge<unknown>>([])
  const vPressed = useKeyPress('v')
  const aPressed = useKeyPress('a')
  const [showChatPanel, setShowChatPanel] = useState(false)

  // Wrap onNodesChange to track node selection
  const onNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeBase>[0]) => {
      // Track selection changes
      const selectedChanges = changes.filter(change => change.type === 'select' && change.selected)
      if (selectedChanges.length > 0) {
        analytics.track('node_selected', { count: selectedChanges.length })
      }
      onNodesChangeBase(changes)
    },
    [onNodesChangeBase]
  )

  // Update URL when project name changes (for when loading a project from file/storage)
  // This updates the router, which will trigger projectName to update via useMemo
  const setProjectName = useCallback(
    (nameOrUpdater: React.SetStateAction<string | null>) => {
      // Handle both direct values and updater functions
      const name =
        typeof nameOrUpdater === 'function'
          ? nameOrUpdater(projectName ?? null)
          : nameOrUpdater

      if (name) {
        navigate(`/examples/${name}`, { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    },
    [navigate, projectName],
  )

  // Eagerly start loading AI context bundles on app start
  useEffect(() => {
    globalContextManager.startLoading().catch((error) => {
      console.warn('Failed to preload AI context:', error)
    })
  }, [])

  // `transformGraph` needs all nodes to build the opMap and resolve connections
  const operators = useMemo(
    () => transformGraph({ nodes, edges }),
    [nodes, edges],
  )

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
  const { onConnect, onNodesDelete } = useProjectModifications({
    getNodes: useCallback(() => nodes, [nodes]),
    getEdges: useCallback(() => edges, [edges]),
    setNodes,
    setEdges,
  })

  const onReconnect = useCallback(
    (oldEdge: ReactFlowEdge, newConnection: Connection) =>
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els)),
    [setEdges],
  )

  const onNodeClick = useCallback((_e: React.MouseEvent, node: ReactFlowNode<unknown>) => {
    const store = getOpStore()
    const obj = store.getSheetObject(node.id)
    if (obj) studio.setSelection([obj])
  }, [])

  const reactFlowRef = useRef<HTMLDivElement>(null)
  const blockLibraryRef = useRef<BlockLibraryRef>(null)

  // Avoid circular dependency
  const loadProjectFileRef = useRef<(project: NoodlesProjectJSON, name?: string) => void>()

  const currentProjectRef = useRef<NoodlesProjectJSON>(newProjectJSON)

  // Ref to access undo/redo functionality from inside ReactFlow context
  const undoRedoRef = useRef<UndoRedoHandlerRef>(null)

  const onDeselectAll = useCallback(() => {
    setNodes((nodes) => nodes.map((node) => ({ ...node, selected: false })))
    setEdges((edges) => edges.map((edge) => ({ ...edge, selected: false })))
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

  const vPressHandledRef = useRef(false)

  const currentContainerId = useNestingStore(state => state.currentContainerId)

  // Handle 'v' key press to create ViewerOp
  useEffect(() => {
    if (!vPressed) {
      // Reset the flag when key is released
      vPressHandledRef.current = false
      return
    }

    // Only handle once per key press
    if (vPressHandledRef.current) return
    vPressHandledRef.current = true

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
              id: edgeId({ source: hoveredHandle.nodeId, sourceHandle, target: viewerId, targetHandle }),
              source: hoveredHandle.nodeId,
              sourceHandle,
              target: viewerId,
              targetHandle,
            }

            setEdges((currentEdges) => [...currentEdges, newEdge])
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
        setEdges((currentEdges) => [...currentEdges, newEdge])
      }

      return [...currentNodes, viewerNode]
    })
  }, [vPressed, setNodes, setEdges, currentContainerId])

  const aPressHandledRef = useRef(false)

  // Handle 'a' key press to open Block Library
  useEffect(() => {
    if (!aPressed) {
      // Reset the flag when key is released
      aPressHandledRef.current = false
      return
    }

    // Only handle once per key press
    if (aPressHandledRef.current) return
    aPressHandledRef.current = true

    analytics.track('block_library_opened', { method: 'keyboard' })

    // Open Block Library at center of screen
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return

    const centerX = pane.left + pane.width / 2
    const centerY = pane.top + pane.height / 2
    blockLibraryRef.current?.openModal(centerX, centerY)
  }, [aPressed])

  const editorSheet = useMemo(() => {
    return theatreSheet.object('editor', {
      showOverlay: types.boolean(!IS_PROD),
      layoutMode: types.stringLiteral('noodles-on-top', {
        split: 'Split',
        'noodles-on-top': 'Noodles on Top',
        'output-on-top': 'Output on Top',
      }),
    })
  }, [theatreSheet])

  const { showOverlay, layoutMode } = useSheetValue(editorSheet)

  const loadProjectFile = useCallback(
    (project: NoodlesProjectJSON, name?: string) => {
      const {
        nodes,
        edges,
        // viewport, // Skip viewport to preserve current view
        timeline,
      } = project

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
      setTheatreProject(name ? { state: timeline } : {}, name)

      // Only fit view when loading a new project (not during undo/redo)
      if (name && !undoRedoRef.current?.isRestoring()) {
        // Fit view after a short delay to ensure nodes are rendered
        setTimeout(() => {
          try {
            if (reactFlowRef.current && nodes.length > 0) {
              // TODO: Call fitView on the ReactFlow instance here if accessible
            }
          } catch (error) {
            console.warn('Could not fit view:', error)
          }
        }, 100)
      }

      // Update URL query parameter with project name
      if (name) {
        navigate(`/examples/${name ?? ''}`, { replace: true })
      }
    },
    [setNodes, setEdges, setProjectName, setTheatreProject, navigate],
  )

  // Assign to ref for undo/redo system
  loadProjectFileRef.current = loadProjectFile

  // Keyboard shortcuts are now handled by UndoRedoHandler component

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadProjectFile would cause infinite loop
  useEffect(() => {
    (async () => {
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
      const noodlesFile = exampleProjects[projectKey] as Partial<NoodlesProjectJSON> | undefined

      if (noodlesFile) {
        const project = await migrateProject({
          ...EMPTY_PROJECT,
          ...noodlesFile,
        } as NoodlesProjectJSON)
        // Set project name and storage type for public projects so @/ asset paths work
        setCurrentDirectory(null, projectName)
        setActiveStorageType('publicFolder')
        loadProjectFile(project, projectName)
        return
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

  const flowGraph = theatreReady && (
    <ErrorBoundary>
      <div
        className={cx(
          'react-flow-wrapper',
          !showOverlay && 'react-flow-wrapper-hidden',
        )}
      >
        <PrimeReactProvider>
          <SheetProvider value={theatreSheet}>
            <Breadcrumbs />
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
              nodeTypes={nodeComponents}
              edgeTypes={edgeComponents}
            >
              <Background />
              <Controls position="bottom-right" />
              <BlockLibrary ref={blockLibraryRef} reactFlowRef={reactFlowRef} />
              <CopyControls />
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
          onClose={() => setShowProjectNotFoundDialog(false)}
        />
        <StorageErrorHandler />
      </div>
    </ErrorBoundary>
  )

  // Assume there's always one 'out' op.
  const OUT_OP_ID = '/out'
  const outOp = operators.find((n) => n.id === OUT_OP_ID)! as unknown as OutOp

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
      if (categories.geojson.includes(node.type)) {
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
              let instantiatedExtensions
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
                    if (
                      typeof extensionDef === 'object' &&
                      'ExtensionClass' in extensionDef
                    ) {
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
                ...(instantiatedExtensions
                  ? { extensions: instantiatedExtensions }
                  : {}),
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
              widgets: widgets?.map(
                ({ type, ...widget }) => new deckWidgets[type](widget),
              ),
            },
            mapProps,
          })
        },
      )
      return () => {
        visSub.unsubscribe()
      }
    }
  }, [outOp, selectedGeoJsonFeatures])

  const menuBar = (
    <NoodlesMenubar
      projectName={projectName}
      setProjectName={setProjectName}
      getTimelineJson={getTimelineJson}
      loadProjectFile={loadProjectFile}
      undoRedo={undoRedoRef.current}
      showChatPanel={showChatPanel}
      setShowChatPanel={setShowChatPanel}
    />
  )

  const right = (
    <div className={s.rightPanel}>
      <PropertyPanel />
      <DropTarget />
    </div>
  )

  return {
    widgets: {
      flowGraph,
      bottom: menuBar,
      top: <ProjectNameBar projectName={projectName} />,
      right,
    },
    layoutMode,
    ...visProps,
    project: theatreProject,
    sheet: theatreSheet,
  }
}
