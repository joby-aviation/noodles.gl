import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from './mcp-tools'
import { getToolDefinition, toolDefinitions } from './tool-definitions'

// The tool surface the in-app chat offered before definitions were shared —
// guards against accidentally changing the chat's token budget or tool names
const CHAT_TOOL_NAMES = [
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
]

const CONTEXT_TOOL_NAMES = [
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
  it('exposes exactly the original chat tools to the chat', () => {
    const chatExposed = toolDefinitions.filter(d => d.exposeToChat !== false).map(d => d.name)
    expect(chatExposed.sort()).toEqual([...CHAT_TOOL_NAMES].sort())
  })

  it('includes the context tools as non-chat definitions', () => {
    const hidden = toolDefinitions.filter(d => d.exposeToChat === false).map(d => d.name)
    expect(hidden.sort()).toEqual([...CONTEXT_TOOL_NAMES].sort())
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
