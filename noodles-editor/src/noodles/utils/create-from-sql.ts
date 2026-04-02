import newProjectJSON from '../new.json'
import type { NoodlesProjectJSON } from './serialization'
import { NOODLES_VERSION } from './serialization'

export interface CreateFromSQLOptions {
  sql: string
}

export function createProjectFromSQL({ sql }: CreateFromSQLOptions): NoodlesProjectJSON {
  // Start with base template from new.json
  const baseProject = { ...newProjectJSON }

  // Create DuckDBOp node
  const duckDbNode = {
    id: '/query',
    type: 'DuckDbOp',
    data: {
      inputs: {
        query: sql,
      },
      locked: false,
    },
    position: { x: 100, y: 200 },
  }

  // Create position accessor node
  // Use fallback chain for common column name patterns
  const positionAccessorNode = {
    id: '/position',
    type: 'AccessorOp',
    data: {
      inputs: {
        expression: '[d.lng || d.lon || d.longitude || 0, d.lat || d.latitude || 0]',
      },
      locked: false,
    },
    position: { x: 400, y: 100 },
  }

  // Create color accessor node with default orange-red
  const colorAccessorNode = {
    id: '/color',
    type: 'AccessorOp',
    data: {
      inputs: {
        expression: '[255, 100, 100]',
      },
      locked: false,
    },
    position: { x: 400, y: 300 },
  }

  // Create ScatterplotLayerOp node
  const scatterplotNode = {
    id: '/points',
    type: 'ScatterplotLayerOp',
    data: {
      inputs: {
        opacity: 0.8,
        getRadius: 50,
      },
      locked: false,
    },
    position: { x: 700, y: 200 },
  }

  // Update deck renderer position for better layout
  const updatedNodes = baseProject.nodes.map(node => {
    if (node.type === 'DeckRendererOp') {
      return { ...node, position: { x: 1000, y: 200 } }
    }
    if (node.type === 'OutOp') {
      return { ...node, position: { x: 1300, y: 200 } }
    }
    return node
  })

  // Add new nodes
  const nodes = [
    ...updatedNodes,
    duckDbNode,
    positionAccessorNode,
    colorAccessorNode,
    scatterplotNode,
  ]

  // Create edges connecting the graph
  const newEdges = [
    {
      id: '/query.out.data->/points.par.data',
      source: '/query',
      target: '/points',
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    },
    {
      id: '/position.out.accessor->/points.par.getPosition',
      source: '/position',
      target: '/points',
      sourceHandle: 'out.accessor',
      targetHandle: 'par.getPosition',
    },
    {
      id: '/color.out.accessor->/points.par.getFillColor',
      source: '/color',
      target: '/points',
      sourceHandle: 'out.accessor',
      targetHandle: 'par.getFillColor',
    },
    {
      id: '/points.out.layer->/deck.par.layers',
      source: '/points',
      target: '/deck',
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    },
  ]

  const edges = [...baseProject.edges, ...newEdges]

  return {
    ...baseProject,
    nodes,
    edges,
    version: NOODLES_VERSION,
  }
}

export function validateSQL(sql: string): { valid: boolean; error?: string } {
  if (!sql || sql.trim().length === 0) {
    return { valid: false, error: 'SQL query is empty' }
  }

  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT')) {
    return { valid: false, error: 'SQL query must start with SELECT' }
  }

  return { valid: true }
}
