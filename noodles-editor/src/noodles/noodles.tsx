import type { AnyNodeJSON } from 'SKIP-@xyflow/react'
import * as deckWidgets from '@deck.gl/widgets'
import { getProject, type IProjectConfig, types } from '@theatre/core'
import studio from '@theatre/studio'
import type {
  Connection,
  DefaultEdgeOptions,
  FitViewOptions,
  OnConnect,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
} from '@xyflow/react'
import {
  addEdge,
  applyEdgeChanges,
  Background,
  Controls,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
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

import '@deck.gl/widgets/stylesheet.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'
import '@xyflow/react/dist/style.css'
import 'primereact/resources/themes/md-dark-indigo/theme.css'
import 'primeicons/primeicons.css'

import { SheetProvider } from '../utils/sheet-context'
import useSheetValue from '../utils/use-sheet-value'
import type { Visualization } from '../visualizations'
import { AddNodeMenu, type AddNodeMenuRef } from './components/add-node-menu'
import { Breadcrumbs } from './components/Breadcrumbs'
import { CopyControls } from './components/copy-controls'
import { DropTarget } from './components/drop-target'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NodesMenubar } from './components/menu'
import { PropertyPanel } from './components/node-properties'
import { categories, edgeComponents, nodeComponents } from './components/op-components'
import { ProjectNameBar, UNSAVED_PROJECT_NAME } from './components/project-name-bar'
import { ProjectNotFoundDialog } from './components/project-not-found-dialog'
import { StorageErrorHandler } from './components/storage-error-handler'
import { ListField } from './fields'
import { useActiveStorageType, useFileSystemStore } from './filesystem-store'
import { IS_PROD, projectId } from './globals'
import s from './noodles.module.css'
import type { IOperator, Operator, OpType, OutOp } from './operators'
import { extensionMap } from './operators'
import { load } from './storage'
import { opMap, useSlice, hoveredOutputHandle } from './store'
import { transformGraph } from './transform-graph'
import { canConnect } from './utils/can-connect'
import { edgeId, nodeId } from './utils/id-utils'
import { migrateProject } from './utils/migrate-schema'
import { getParentPath, parseHandleId } from './utils/path-utils'
import { pick } from './utils/pick'
import { EMPTY_PROJECT, type NoodlesProjectJSON } from './utils/serialization'

export type Edge<N1 extends Operator<IOperator>, N2 extends Operator<IOperator>> = {
  id: `${N1['id']}/${keyof N1['outputs']}->${N2['id']}/${keyof N2['inputs']}`
  source: N1['id']
  target: N2['id']
  sourceHandle: `${N1['id']}/${keyof N1['outputs']}`
  targetHandle: `${N2['id']}/${keyof N2['inputs']}`
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
      // Theatre stores too much state if you don't reset it
      studio.transaction(api => {
        api.__experimental_forgetSheet(theatreSheet)
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

    // Clear staticOverrides to prevent them from being saved, only preserve editor and render
    // objects since we're storing that state in Theatre
    const sheetsById = Object.fromEntries(
      Object.entries(
        timeline.sheetsById as Record<string, { staticOverrides?: { byObject?: unknown } }>
      ).map(([sheetId, sheet]) => [
        sheetId,
        {
          ...sheet,
          staticOverrides: {
            byObject: pick(sheet.staticOverrides?.byObject || {}, ['editor', 'render']),
          },
        },
      ])
    )

    return { ...timeline, sheetsById }
  }, [theatreState.name])

  return { theatreReady, theatreProject, theatreSheet, setTheatreProject, getTimelineJson }
}

// Not using the top-level sheet since a Noodles theatre sheet and project are dynamically created.
// Also, the top-level sheet is used for theatre-managed project files, whereas a Noodles project file is managed within this visType.
export function getNoodles(): Visualization {
  const [projectName, setProjectName] = useState<string>()
  const [showProjectNotFoundDialog, setShowProjectNotFoundDialog] = useState(false)
  const storageType = useActiveStorageType()
  const { setCurrentDirectory, setError } = useFileSystemStore()
  const { theatreReady, theatreProject, theatreSheet, setTheatreProject, getTimelineJson } =
    useTheatreJs(projectName)
  const ops = useSlice(state => state.ops)
  const sheetObjects = useSlice(state => state.sheetObjects)
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNodeJSON>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<ReactFlowEdge<unknown>>([])
  const vPressed = useKeyPress('v')

  // `transformGraph` needs all nodes to build the opMap and resolve connections
  const operators = useMemo(() => transformGraph({ nodes, edges }), [nodes, edges])

  const onReconnect = useCallback(
    (oldEdge: ReactFlowEdge, newConnection: Connection) =>
      setEdges(els => reconnectEdge(oldEdge, newConnection, els)),
    [setEdges]
  )

  const onConnect: OnConnect = useCallback(
    connection => {
      const newEdge = {
        ...connection,
        id: edgeId(connection),
      }

      const source = nodes.find(n => n.id === connection.source) as
        | ReactFlowNode<OpType>
        | undefined
      if (!source) {
        console.warn('Invalid source', connection)
        return
      }
      const targetIndex = nodes.findIndex(n => n.id === connection.target)
      const target = nodes[targetIndex] as ReactFlowNode<OpType> | undefined
      if (!target) {
        console.warn('Invalid target', connection)
        return
      }

      const sourceOp = ops.get(source.id)
      const targetOp = ops.get(target.id)

      if (!sourceOp || !targetOp) {
        console.warn('Invalid source or target', connection)
        return
      }

      // TODO: multiple connections: https://reactflow.dev/examples/edges/multi-connection-line
      // Extract field names from qualified handle IDs
      const sourceHandleInfo = parseHandleId(connection.sourceHandle!)
      const targetHandleInfo = parseHandleId(connection.targetHandle!)

      if (!sourceHandleInfo || !targetHandleInfo) {
        console.warn('Invalid handle IDs', connection)
        return
      }

      const sourceField = sourceOp.outputs[sourceHandleInfo.fieldName]
      const targetField = targetOp.inputs[targetHandleInfo.fieldName]
      if (!sourceField || !targetField) {
        console.warn('Invalid connection', connection)
        return
      }

      // TODO: Mark the edge as invalid visually
      if (!canConnect(sourceField, targetField)) {
        return
      }

      setEdges(eds => {
        const existing = eds.find(
          e => e.target === newEdge.target && e.targetHandle === newEdge.targetHandle
        )
        if (existing && !(targetField instanceof ListField)) {
          return applyEdgeChanges([{ type: 'replace', id: existing.id, item: newEdge }], eds)
        }
        return addEdge(newEdge, eds)
      })

      setNodes(nds => {
        const updated = [...nds]
        const value =
          targetField instanceof ListField
            ? Array.from(targetField.fields.values()).map(f => f.value)
            : sourceField.value

        updated[targetIndex] = {
          ...target,
          data: {
            ...target.data,
            inputs: {
              ...target.data?.inputs,
              [sourceHandleInfo.fieldName]: value,
            },
          },
        }

        return updated
      })

      targetField.addConnection(newEdge.id, sourceField)
    },
    [nodes, setNodes, setEdges, ops]
  )

  const onNodesDelete = useCallback(
    (deleted: ReactFlowNode<unknown>[]) => {
      const extraDeleted = new Set()
      for (const node of deleted) {
        // Delete the parent node, and the BeginOp if the EndOp is deleted, or the EndOp if the BeginOp is deleted
        if (node.type === 'ForLoopBeginOp' || node.type === 'ForLoopEndOp') {
          const parent = node.parentId
          extraDeleted.add(parent)
          const siblingType = node.type === 'ForLoopBeginOp' ? 'ForLoopEndOp' : 'ForLoopBeginOp'
          const sibling = nodes.find(n => n.parentId === parent && n.type === siblingType)
          if (sibling) {
            extraDeleted.add(sibling.id)
          }
        }
      }
      if (extraDeleted.size) {
        setNodes(nds => {
          return nds
            .filter(n => !extraDeleted.has(n.id))
            .map(n => {
              if (extraDeleted.has(n.parentId)) {
                return { ...n, parentId: undefined }
              }
              return n
            })
        })
      }

      setEdges(
        deleted.reduce((acc, node) => {
          const incomers = getIncomers(node, nodes, edges)
          const outgoers = getOutgoers(node, nodes, edges)
          const connectedEdges = getConnectedEdges([node], edges)

          const remainingEdges = acc.filter(edge => !connectedEdges.includes(edge))

          // Intelligently update the sourceHandle and targetHandle of the edges. This is simple for now
          const sourceHandle = connectedEdges.find(edge => edge.target === node.id)?.sourceHandle
          if (!sourceHandle) {
            console.warn('Invalid source handle', node)
            return remainingEdges
          }
          const targetHandle = connectedEdges.find(edge => edge.source === node.id)?.targetHandle
          if (!targetHandle) {
            console.warn('Invalid target handle', node)
            return remainingEdges
          }

          // Parse handle IDs to get field names
          const sourceHandleInfo = parseHandleId(sourceHandle)
          const targetHandleInfo = parseHandleId(targetHandle)

          if (!sourceHandleInfo || !targetHandleInfo) {
            console.warn('Invalid handle IDs', sourceHandle, targetHandle)
            return remainingEdges
          }

          const createdEdges = incomers.flatMap(({ id: source }) =>
            outgoers
              .filter(({ id: target }) => {
                const sourceField = opMap.get(source)?.outputs[sourceHandleInfo.fieldName]
                const targetField = opMap.get(target)?.inputs[targetHandleInfo.fieldName]
                if (!sourceField || !targetField) {
                  console.warn('Invalid source or target field', source, target)
                  return false
                }
                return canConnect(sourceField, targetField)
              })
              .map(({ id: target }) => ({
                id: edgeId({
                  source,
                  target,
                  sourceHandle,
                  targetHandle,
                }),
                source,
                target,
                sourceHandle,
                targetHandle,
              }))
          )

          return [...remainingEdges, ...createdEdges]
        }, edges)
      )
    },
    [nodes, edges, setNodes, setEdges]
  )

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: ReactFlowNode<unknown>) => {
      const obj = sheetObjects.get(node.id)
      if (obj) studio.setSelection([obj])
    },
    [sheetObjects]
  )

  const reactFlowRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<AddNodeMenuRef>(null)

  const onDeselectAll = useCallback(() => {
    setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
    setEdges(edges => edges.map(edge => ({ ...edge, selected: false })))
  }, [setNodes, setEdges])

  const onPaneClick = useCallback(() => {
    menuRef.current?.closeMenu()
    onDeselectAll()
  }, [onDeselectAll])

  const onPaneContextMenu = useCallback((event: React.MouseEvent<Element, MouseEvent>) => {
    event.preventDefault()
    // Show Add Node menu
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return
    menuRef.current?.openMenu({
      top: event.clientY < pane.height - 200 ? event.clientY : 0,
      left: event.clientX < pane.width - 400 ? event.clientX - 200 : 0,
      right: event.clientX >= pane.width - 200 ? pane.width - event.clientX : 0,
      bottom: event.clientY >= pane.height - 200 ? pane.height - event.clientY : 0,
    })
  }, [])

  const vPressHandledRef = useRef(false)

  const { currentContainerId } = useSlice(state => state.nesting)

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

    setNodes(currentNodes => {
      const selectedNodes = currentNodes.filter(n => n.selected)
      if (selectedNodes.length === 0) {
        if (hoveredOutputHandle) {
          const hoveredNode = currentNodes.find(n => n.id === hoveredOutputHandle.nodeId)
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

            const sourceHandle = hoveredOutputHandle.handleId
            const targetHandle = 'par.data'
            const newEdge = {
              id: edgeId({ source: hoveredOutputHandle.nodeId, sourceHandle, target: viewerId, targetHandle }),
              source: hoveredOutputHandle.nodeId,
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
      if (hoveredOutputHandle && selectedNodes.some(n => n.id === hoveredOutputHandle.nodeId)) {
        // Use hovered handle if it's on a selected node
        // Handle ID is already in the format "out.fieldName"
        if (hoveredOutputHandle.handleId.startsWith('out.')) {
          sourceNodeId = hoveredOutputHandle.nodeId
          sourceHandle = hoveredOutputHandle.handleId
        }
      }

      // If no hovered handle, use the first output handle of the rightmost node
      if (!sourceHandle) {
        const sourceOp = ops.get(sourceNodeId)
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
          id: edgeId({ source: sourceNodeId, sourceHandle, target: viewerId, targetHandle }),
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
  }, [vPressed, ops, setNodes, setEdges, currentContainerId])

  const editorSheet = useMemo(() => {
    return theatreSheet.object('editor', {
      showOverlay: types.boolean(!IS_PROD),
      layoutMode: types.stringLiteral('split', {
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
        // viewport, // TODO: Set viewport in React Flow (needs to be done in a ReactFlowContext)
        timeline,
      } = project
      for (const op of opMap.values()) {
        op.unsubscribeListeners()
      }
      opMap.clear()
      setNodes(nodes)
      setEdges(edges)
      setProjectName(name)
      setTheatreProject(name ? { state: timeline } : {}, name)

      // Update URL query parameter with project name
      if (name) {
        const url = new URL(window.location.href)
        url.searchParams.set('project', name)
        window.history.replaceState({}, '', url.toString())
      }
    },
    [setNodes, setEdges, setTheatreProject]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadProjectFile would cause infinite loop
  useEffect(() => {
    ;(async () => {
      if (projectId) {
        // First try to load from static files (for built-in examples)
        try {
          let req = await fetch(`./noodles/${projectId}.json`)
          if (!req.ok) {
            req = await fetch(`./noodles/${projectId}/noodles.json`)
          }
          const noodlesFile = (await req.json()) as Partial<NoodlesProjectJSON>
          const project = await migrateProject({
            ...EMPTY_PROJECT,
            ...noodlesFile,
          } as NoodlesProjectJSON)
          loadProjectFile(project, projectId)
          return
        } catch (_error) {
          console.log('Static project file not found, trying storage...')
        }

        // Try to load from storage (OPFS or File System Access API)
        try {
          const result = await load(storageType, projectId)
          if (result.success) {
            const project = await migrateProject(result.data.projectData)
            // Update store with directory handle and project name
            setCurrentDirectory(result.data.directoryHandle, projectId)
            loadProjectFile(project, projectId)
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
      }
    })()
  }, [])

  const displayedNodes = useMemo(() => {
    // If no containerId, show all nodes
    // TODO: add support for for-loop begin/end nodes
    // return nodes.filter(node =>
    //   'containerId' in node ? node.containerId === currentContainerId : currentContainerId === null
    // )

    return nodes.map(node => ({
      ...node,
      hidden: getParentPath(node.id) !== currentContainerId,
      dragHandle: `.${s.header}`,
    }))
  }, [currentContainerId, nodes])

  const activeEdges = useMemo(() => {
    return edges.map(edge => ({
      ...edge,
      sourceHandle: edge.type === 'ReferenceEdge' ? null : edge.sourceHandle,
    }))
  }, [edges])

  const flowGraph = theatreReady && (
    <ErrorBoundary>
      <div className={cx('react-flow-wrapper', !showOverlay && 'react-flow-wrapper-hidden')}>
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
              fitView
              fitViewOptions={fitViewOptions}
              defaultEdgeOptions={defaultEdgeOptions}
              nodeTypes={nodeComponents}
              edgeTypes={edgeComponents}
            >
              <Background />
              <Controls position="bottom-right" />
              <AddNodeMenu ref={menuRef} reactFlowRef={reactFlowRef} />
              <CopyControls />
            </ReactFlow>
          </SheetProvider>
        </PrimeReactProvider>
        <ProjectNotFoundDialog
          projectName={projectId || ''}
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
  const outOp = operators.find(n => n.id === OUT_OP_ID)! as unknown as OutOp

  const [visProps, setVisProps] = useState(outOp?.inputs.vis.value || {})

  // Create overlay layer for selected GeoJSON-producing operators
  const selectedGeoJsonFeatures = useMemo(() => {
    const features: unknown[] = []
    const selectedNodes = nodes.filter(n => n.selected)

    for (const node of selectedNodes) {
      const op = ops.get(node.id)
      if (!op) continue

      // Check if this is a GeoJSON-producing operator
      if (categories.geojson.includes(node.type)) {
        const feature = op.outputs.feature?.value
        if (feature) features.push(feature)
      }
    }

    return features
  }, [nodes, ops])

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

  const menuBar = (
    <NodesMenubar
      projectName={projectName}
      setProjectName={setProjectName}
      getTimelineJson={getTimelineJson}
      loadProjectFile={loadProjectFile}
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
