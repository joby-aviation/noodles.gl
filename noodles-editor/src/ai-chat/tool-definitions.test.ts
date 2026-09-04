import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from './mcp-tools'
import { getToolDefinition, toolDefinitions } from './tool-definitions'

// The full Noodles capability surface. Every definition is callable by both the
// chat (via agent/tool-router.ts) and WebMCP — this list guards against a tool
// being renamed or dropped by accident.
const ALL_TOOL_NAMES = [
  'capture_visualization',
  'get_console_errors',
  'get_render_stats',
  'inspect_layer',
  'apply_modifications',
  'get_current_project',
  'list_nodes',
  'get_node_info',
  'get_node_output',
  'get_timeline',
  'set_keyframe',
  'delete_keyframe',
  'set_playback_position',
  'search_code',
  'get_source_code',
  'get_operator_schema',
  'list_operators',
  'get_documentation',
  'get_example',
  'list_examples',
  'find_symbol',
  'analyze_project',
]

describe('toolDefinitions', () => {
  it('defines the whole capability surface', () => {
    expect(toolDefinitions.map(d => d.name).sort()).toEqual([...ALL_TOOL_NAMES].sort())
  })

  it('does not reserve the router-owned find_tools name', () => {
    // find_tools is harness machinery in agent/tool-router.ts, not a Noodles
    // capability, so it must not appear here or WebMCP would advertise it
    expect(toolDefinitions.some(d => d.name === 'find_tools')).toBe(false)
  })

  it('has unique snake_case names', () => {
    const names = toolDefinitions.map(d => d.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('has a description and object input schema on every definition', () => {
    for (const def of toolDefinitions) {
      expect(def.description.length, def.name).toBeGreaterThan(0)
      expect(def.inputSchema.type, def.name).toBe('object')
      expect(typeof def.inputSchema.properties, def.name).toBe('object')
    }
  })

  it('marks exactly the mutating tools as non-read-only', () => {
    const writeTools = toolDefinitions
      .filter(d => d.annotations.readOnlyHint === false)
      .map(d => d.name)
    expect(writeTools.sort()).toEqual([
      'apply_modifications',
      'delete_keyframe',
      'set_keyframe',
      'set_playback_position',
    ])
  })

  it('declares annotations on every definition', () => {
    for (const def of toolDefinitions) {
      expect(typeof def.annotations.readOnlyHint, def.name).toBe('boolean')
    }
  })

  it('only requires properties that exist in the schema', () => {
    for (const def of toolDefinitions) {
      for (const required of def.inputSchema.required ?? []) {
        expect(def.inputSchema.properties, `${def.name}.${required}`).toHaveProperty(required)
      }
    }
  })

  it('looks up definitions by name', () => {
    expect(getToolDefinition('list_nodes')?.name).toBe('list_nodes')
    expect(getToolDefinition('nonexistent_tool')).toBeUndefined()
  })

  it('injects the current project into analyze_project', async () => {
    const analyzeProject = vi.fn(async () => ({ success: true }))
    const tools = { analyzeProject } as unknown as MCPTools
    const definition = getToolDefinition('analyze_project')
    if (!definition) throw new Error('analyze_project not defined')

    const project = { nodes: [], edges: [] }
    await definition.execute(tools, { analysisType: 'validation' }, () => project)
    expect(analyzeProject).toHaveBeenCalledWith({ project, analysisType: 'validation' })

    const noProject = await definition.execute(tools, { analysisType: 'validation' }, () => null)
    expect(noProject.success).toBe(false)
    expect(noProject.error).toContain('No project loaded')
  })
})
