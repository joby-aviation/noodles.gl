import { beforeEach, describe, expect, it } from 'vitest'
import { getOpStore } from '../store'
import { transformGraph } from '../transform-graph'
import { createProjectFromSQL } from '../utils/create-from-sql'

describe('createFromSQL integration', () => {
  beforeEach(() => {
    // Clear operator store before each test
    const store = getOpStore()
    store.clearOps()
  })

  it('generates a valid graph that can be transformed', () => {
    const sql = 'SELECT lng, lat, value FROM data'
    const project = createProjectFromSQL({ sql })

    // Should be able to transform without errors
    expect(() => {
      transformGraph({ nodes: project.nodes, edges: project.edges })
    }).not.toThrow()
  })

  it('creates operators that can execute', () => {
    const sql = 'SELECT 1 as id, -74.0 as lng, 40.7 as lat'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Find DuckDBOp
    const duckDbOp = operators.find(op => op.constructor.name === 'DuckDbOp')
    expect(duckDbOp).toBeDefined()

    // Should have the SQL query
    expect(duckDbOp?.inputs.query.value).toBe(sql)
  })

  it('creates a complete visualization pipeline', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Check for complete pipeline
    const opTypes = operators.map(op => op.constructor.name)
    expect(opTypes).toContain('DuckDbOp')
    expect(opTypes).toContain('ScatterplotLayerOp')
    expect(opTypes).toContain('AccessorOp')
    expect(opTypes).toContain('DeckRendererOp')
    expect(opTypes).toContain('OutOp')
  })

  it('creates valid edges that connect operators', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Find ScatterplotLayer
    const scatterplotOp = operators.find(op => op.constructor.name === 'ScatterplotLayerOp')
    expect(scatterplotOp).toBeDefined()

    // Check that data input is connected
    const dataField = scatterplotOp?.inputs.data
    expect(dataField).toBeDefined()
    expect(dataField?.subscriptions.size).toBeGreaterThan(0)

    // Position accessor should be connected
    const positionField = scatterplotOp?.inputs.getPosition
    expect(positionField).toBeDefined()
    expect(positionField?.subscriptions.size).toBeGreaterThan(0)

    // Color accessor should be connected
    const fillColorField = scatterplotOp?.inputs.getFillColor
    expect(fillColorField).toBeDefined()
    expect(fillColorField?.subscriptions.size).toBeGreaterThan(0)
  })

  it('creates DeckRenderer with connected layer', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Find DeckRenderer
    const deckOp = operators.find(op => op.constructor.name === 'DeckRendererOp')
    expect(deckOp).toBeDefined()

    // Layers field should be connected
    const layersField = deckOp?.inputs.layers
    expect(layersField).toBeDefined()
    expect(layersField?.subscriptions.size).toBeGreaterThan(0)
  })

  it('creates OutOp with connected visualization', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Find OutOp
    const outOp = operators.find(op => op.constructor.name === 'OutOp')
    expect(outOp).toBeDefined()

    // Vis field should be connected
    const visField = outOp?.inputs.vis
    expect(visField).toBeDefined()
    expect(visField?.subscriptions.size).toBeGreaterThan(0)
  })

  it('creates accessors with correct expressions', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Find accessor operators
    const accessors = operators.filter(op => op.constructor.name === 'AccessorOp')
    expect(accessors.length).toBeGreaterThanOrEqual(2)

    // Check position accessor
    const positionAccessor = accessors.find(op => op.id === '/position')
    expect(positionAccessor).toBeDefined()
    expect(positionAccessor?.inputs.expression.value).toContain('lng')
    expect(positionAccessor?.inputs.expression.value).toContain('lat')

    // Check color accessor
    const colorAccessor = accessors.find(op => op.id === '/color')
    expect(colorAccessor).toBeDefined()
    expect(colorAccessor?.inputs.expression.value).toBe('[255, 100, 100]')
  })

  it('creates operators with correct IDs', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Find key operators by ID
    const duckDbOp = operators.find(op => op.id === '/query')
    const scatterplotOp = operators.find(op => op.id === '/points')
    const positionAccessor = operators.find(op => op.id === '/position')
    const colorAccessor = operators.find(op => op.id === '/color')

    expect(duckDbOp).toBeDefined()
    expect(scatterplotOp).toBeDefined()
    expect(positionAccessor).toBeDefined()
    expect(colorAccessor).toBeDefined()
  })

  it('preserves base project structure', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const operators = transformGraph({ nodes: project.nodes, edges: project.edges })

    // Should include MaplibreBasemap from base template
    const maplibreOp = operators.find(op => op.constructor.name === 'MaplibreBasemapOp')
    expect(maplibreOp).toBeDefined()

    // Check basemap is connected to DeckRenderer
    const deckOp = operators.find(op => op.constructor.name === 'DeckRendererOp')
    expect(deckOp).toBeDefined()
    expect(deckOp?.inputs.basemap.subscriptions.size).toBeGreaterThan(0)
  })
})
