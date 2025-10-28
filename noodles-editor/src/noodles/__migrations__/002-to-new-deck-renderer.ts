import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import type { NoodlesProjectJSON } from '../utils/serialization'

export type DeckOpJson = ReactFlowNode<{
  inputs: {
    mapStyle: string | null
    viewState: {
      latitude: number
      longitude: number
      zoom: number
      pitch: number
      bearing: number
    } | null
  }
}>

const NOT_FOUND = -1

// Don't use edgeId from id-utils because the format has changed
function edgeId(edge: ReactFlowEdge) {
  return `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
}

//  1. Create a MaplibreBasemapOp.
//   - Move mapStyle and viewState connections from DeckRendererOp to MaplibreBasemapOp too
//  2. Create a OutOp and connect the DeckRenderer
//  3. Rename ViewStateOp to MapViewStateOp
export async function up(project: NoodlesProjectJSON) {
  const { nodes, edges, ...rest } = project

  // Find DeckRenderer node - there should only be one in the old version
  const deckRendererNode = nodes.find(node => node.type === 'DeckRendererOp') as
    | DeckOpJson
    | undefined

  if (!deckRendererNode) {
    return project
  }

  const {
    id: deckId,
    data: {
      inputs: { mapStyle, viewState },
    },
  } = deckRendererNode

  // Create new nodes
  let newNodes = [...nodes]
  const newEdges = [...edges]

  // 1. Create MaplibreBasemapOp
  // Find connection to DeckRendererOp mapStyle, if any
  const mapStyleEdge = newEdges.findIndex(
    edge => edge.targetHandle === 'mapStyle' && edge.target === deckId
  )
  // Find connection to DeckRendererOp viewState, if any
  const viewStateEdge = newEdges.findIndex(
    edge => edge.targetHandle === 'viewState' && edge.target === deckId
  )

  // Create MaplibreBasemapOp
  const basemapId = 'basemap-0'
  newNodes.push({
    id: basemapId,
    type: 'MaplibreBasemapOp',
    position: {
      x: deckRendererNode.position.x,
      y: deckRendererNode.position.y + 230,
    },
    data: {
      inputs: {
        // If inputs were not set (i.e. something is connect to the field), we don't want to set it in the basemap node
        mapStyle: mapStyleEdge === NOT_FOUND ? mapStyle : null,
        viewState: viewStateEdge === NOT_FOUND ? viewState : null,
      },
    },
  })

  // If there was a connection to the mapStyle field, update mapStyle edge
  if (mapStyleEdge !== NOT_FOUND) {
    const oldEdge = { ...newEdges[mapStyleEdge] }
    newEdges[mapStyleEdge] = {
      id: edgeId({
        source: oldEdge.source,
        target: basemapId,
        sourceHandle: oldEdge.sourceHandle,
        targetHandle: 'mapStyle',
      }),
      source: oldEdge.source,
      target: basemapId,
      sourceHandle: oldEdge.sourceHandle,
      targetHandle: 'mapStyle',
    }
  }

  // If there was a connection to the viewState field, update viewState edge
  if (viewStateEdge !== NOT_FOUND) {
    const oldEdge = { ...newEdges[viewStateEdge] }
    newEdges[viewStateEdge] = {
      id: edgeId({
        source: oldEdge.source,
        target: basemapId,
        sourceHandle: oldEdge.sourceHandle,
        targetHandle: 'viewState',
      }),
      source: oldEdge.source,
      target: basemapId,
      sourceHandle: oldEdge.sourceHandle,
      targetHandle: 'viewState',
    }
  }

  // Add a MaplibreBasemapOp connection to the DeckRendererOp
  newEdges.push({
    id: edgeId({
      source: basemapId,
      target: deckId,
      sourceHandle: 'maplibre',
      targetHandle: 'basemap',
    }),
    source: basemapId,
    target: deckId,
    sourceHandle: 'maplibre',
    targetHandle: 'basemap',
  })

  // 2. OutOp
  // Create the OutOp, which is assumed to be called 'out' in the new version
  const outId = 'out'
  newNodes.push({
    id: outId,
    type: 'OutOp',
    position: {
      x: deckRendererNode.position.x + 250,
      y: deckRendererNode.position.y,
    },
    data: {
      inputs: {},
    },
  })

  // Add a DeckRendererOp connection to the OutOp
  newEdges.push({
    id: edgeId({ source: deckId, target: outId, sourceHandle: 'vis', targetHandle: 'vis' }),
    source: deckId,
    target: outId,
    sourceHandle: 'vis',
    targetHandle: 'vis',
  })

  // 3. Rename ViewStateOp to MapViewStateOp
  newNodes = newNodes.map(node => {
    if (node.type === 'ViewStateOp') {
      node.type = 'MapViewStateOp'
    }
    return node
  })

  return { ...rest, nodes: newNodes, edges: newEdges }
}

// Revert the migration
// 1. Convert MapViewStateOp back to ViewStateOp
// 2. Restore DeckRendererOp id to 'deck'
// 3. Restore viewState and mapStyle from MaplibreBasemapOp to DeckRendererOp, if it was set
//   - Move viewState connection from MaplibreBasemapOp to DeckRendererOp too,
//     unless something was already connected to the DeckRendererOp viewState
// 4. Remove MaplibreBasemapOp and OutOp
// 5. Edges: Remove MaplibreBasemapOp and OutOp edges
export async function down(project: NoodlesProjectJSON) {
  const { nodes, edges, ...rest } = project

  let newNodes = [...nodes]
  const newEdges: ReactFlowEdge[] = [...edges]

  // 1.Convert MapViewStateOp back to ViewStateOp
  newNodes = newNodes.map(node => {
    if (node.type === 'MapViewStateOp') {
      node.type = 'ViewStateOp'
    }
    return node
  })

  // 2. Restore DeckRendererOp id - the old version needs the id to be 'deck'
  // Find DeckRenderer node - only one will be used in the old version
  let deckRendererNode = newNodes.findIndex(node => node.id === 'deck')

  // If the 'deck' node doesn't exist, find the first DeckRendererOp and restore id
  let oldDeckId = 'deck'
  if (deckRendererNode === NOT_FOUND) {
    deckRendererNode = newNodes.findIndex(node => node.type === 'DeckRendererOp')
    // If a DeckRendererOp was found, restore the id
    if (deckRendererNode !== NOT_FOUND) {
      oldDeckId = newNodes[deckRendererNode].id // save the old id to update edges
      newNodes[deckRendererNode].id = 'deck'
    }
  }

  // If still no DeckRendererOp was found, add one
  if (deckRendererNode === NOT_FOUND) {
    newNodes.push({
      id: 'deck',
      type: 'DeckRendererOp',
      position: { x: 0, y: 0 },
    } as DeckOpJson)
    deckRendererNode = newNodes.length - 1
  }

  // 3. Restore viewState and mapStyle from MaplibreBasemapOp to DeckRendererOp, if it was set
  const basemapEdge = edges.find(
    edge =>
      edge.sourceHandle === 'maplibre' &&
      edge.targetHandle === 'basemap' &&
      edge.target === oldDeckId
  ) as ReactFlowEdge | undefined
  const basemapSource = newNodes.find(node => node.id === basemapEdge?.source) as
    | DeckOpJson
    | undefined
  if (basemapSource) {
    ; (newNodes[deckRendererNode] as DeckOpJson).data.inputs.mapStyle =
      basemapSource.data.inputs.mapStyle
      ; (newNodes[deckRendererNode] as DeckOpJson).data.inputs.viewState =
        basemapSource.data.inputs.viewState
  }

  // Edge: If viewState was connected to MaplibreBasemapOp, move connection to DeckRenderer
  const basemapViewStateEdge = newEdges.findIndex(
    edge =>
      edge.sourceHandle === 'viewState' &&
      edge.targetHandle === 'viewState' &&
      edge.target === basemapSource?.id
  )
  if (basemapViewStateEdge !== NOT_FOUND) {
    newEdges[basemapViewStateEdge] = {
      id: edgeId({
        source: newEdges[basemapViewStateEdge].source,
        target: oldDeckId,
        sourceHandle: 'viewState',
        targetHandle: 'viewState',
      }),
      source: newEdges[basemapViewStateEdge].source,
      target: oldDeckId,
      sourceHandle: 'viewState',
      targetHandle: 'viewState',
    }

    // Node: If viewState was connected to the DeckRenderer,
    // unset viewState (takes priority over the basemap op connection)
    const viewStateEdge = edges.find(
      edge =>
        edge.sourceHandle === 'viewState' &&
        edge.targetHandle === 'viewState' &&
        edge.target === oldDeckId
    ) as ReactFlowEdge | undefined
    const viewStateSource = newNodes.find(node => node.id === viewStateEdge?.source) as
      | DeckOpJson
      | undefined
    if (viewStateSource) {
      ; (newNodes[deckRendererNode] as DeckOpJson).data.inputs.viewState = null
    }
  }

  // 4. Filter out nodes that were created during the migration
  const migrationNodes = nodes
    .filter(node => node.type === 'MaplibreBasemapOp' || node.type === 'OutOp')
    .map(node => node.id)
  newNodes = newNodes.filter(node => !migrationNodes.includes(node.id))

  // 5. Filter out edges that aren't part of the migration
  const filteredEdges = newEdges.filter(
    edge => !migrationNodes.includes(edge.source) && !migrationNodes.includes(edge.target)
  )

  return { ...rest, nodes: newNodes, edges: filteredEdges }
}
