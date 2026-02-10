import { describe, expect, it } from 'vitest'
import { createProjectFromSQL, validateSQL } from './create-from-sql'
import { NOODLES_VERSION } from './serialization'

describe('createProjectFromSQL', () => {
  it('creates a valid project with SQL query', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    expect(project.version).toBe(NOODLES_VERSION)
    expect(project.nodes).toBeDefined()
    expect(project.edges).toBeDefined()

    // Check for required nodes
    const nodeTypes = project.nodes.map((n) => n.type)
    expect(nodeTypes).toContain('DuckDbOp')
    expect(nodeTypes).toContain('ScatterplotLayerOp')
    expect(nodeTypes).toContain('AccessorOp')
    expect(nodeTypes).toContain('DeckRendererOp')
    expect(nodeTypes).toContain('OutOp')

    // Check DuckDB node has SQL
    const duckDbNode = project.nodes.find((n) => n.type === 'DuckDbOp')
    expect(duckDbNode?.data.inputs.query).toBe(sql)
  })

  it('creates proper edges between nodes', () => {
    const sql = 'SELECT lng, lat FROM points'
    const project = createProjectFromSQL({ sql })

    // Check key connections exist
    const edgeIds = project.edges.map((e) => e.id)
    expect(edgeIds).toContain('/query.out.data->/points.par.data')
    expect(edgeIds).toContain('/position.out.accessor->/points.par.getPosition')
    expect(edgeIds).toContain('/color.out.accessor->/points.par.getFillColor')
    expect(edgeIds).toContain('/points.out.layer->/deck.par.layers')
    expect(edgeIds).toContain('/deck.out.vis->/out.par.vis')
  })

  it('includes accessor nodes for position and color', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const accessorNodes = project.nodes.filter((n) => n.type === 'AccessorOp')
    expect(accessorNodes.length).toBeGreaterThanOrEqual(2)

    // Check position accessor
    const positionNode = accessorNodes.find((n) => n.id === '/position')
    expect(positionNode).toBeDefined()
    expect(positionNode?.data.inputs.expression).toContain('lng')

    // Check color accessor
    const colorNode = accessorNodes.find((n) => n.id === '/color')
    expect(colorNode).toBeDefined()
    expect(colorNode?.data.inputs.expression).toBe('[255, 100, 100]')
  })

  it('positions nodes in left-to-right layout', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const duckDbNode = project.nodes.find((n) => n.type === 'DuckDbOp')
    const scatterplotNode = project.nodes.find((n) => n.type === 'ScatterplotLayerOp')
    const deckNode = project.nodes.find((n) => n.type === 'DeckRendererOp')

    // Verify left-to-right positioning (x coordinates increase)
    expect(duckDbNode?.position.x).toBeLessThan(scatterplotNode?.position.x || 0)
    expect(scatterplotNode?.position.x).toBeLessThan(deckNode?.position.x || 0)
  })

  it('preserves base project structure from new.json', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    // Should have MaplibreBasemapOp from base template
    const nodeTypes = project.nodes.map((n) => n.type)
    expect(nodeTypes).toContain('MaplibreBasemapOp')

    // Should have base edge from maplibre to deck
    const edgeIds = project.edges.map((e) => e.id)
    expect(edgeIds).toContain('/maplibre-basemap.out.maplibre->/deck.par.basemap')
  })

  it('includes ScatterplotLayerOp with default properties', () => {
    const sql = 'SELECT * FROM data'
    const project = createProjectFromSQL({ sql })

    const scatterplotNode = project.nodes.find((n) => n.type === 'ScatterplotLayerOp')
    expect(scatterplotNode).toBeDefined()
    expect(scatterplotNode?.data.inputs.opacity).toBe(0.8)
    expect(scatterplotNode?.data.inputs.getRadius).toBe(50)
  })
})

describe('validateSQL', () => {
  it('accepts valid SELECT query', () => {
    const result = validateSQL('SELECT * FROM data')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts SELECT with lowercase', () => {
    const result = validateSQL('select * from data')
    expect(result.valid).toBe(true)
  })

  it('accepts SELECT with mixed case', () => {
    const result = validateSQL('SeLeCt * FrOm data')
    expect(result.valid).toBe(true)
  })

  it('accepts SELECT with leading whitespace', () => {
    const result = validateSQL('  \n  SELECT * FROM data')
    expect(result.valid).toBe(true)
  })

  it('rejects empty query', () => {
    const result = validateSQL('')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('empty')
  })

  it('rejects non-SELECT query', () => {
    const result = validateSQL('INSERT INTO data VALUES (1, 2)')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects DROP TABLE query', () => {
    const result = validateSQL('DROP TABLE users')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects UPDATE query', () => {
    const result = validateSQL('UPDATE users SET name = "test"')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects DELETE query', () => {
    const result = validateSQL('DELETE FROM users')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects whitespace-only query', () => {
    const result = validateSQL('   \n  \t  ')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('empty')
  })
})
