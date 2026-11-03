import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from './mcp-tools'
import { availableToolDefinitions, getToolDefinition, toolDefinitions } from './tool-definitions'

// The full Noodles capability surface. Every definition is callable by both the
// chat (via agent/tool-router.ts) and WebMCP — this list guards against a tool
// being renamed or dropped by accident.
const ALL_TOOL_NAMES = [
  'capture_visualization',
  'get_console_errors',
  'get_render_stats',
  'inspect_layer',
  'apply_modifications',
  'run_code',
  'list_files',
  'read_file',
  'write_file',
  'grep_files',
  'get_current_project',
  'list_nodes',
  'get_node_info',
  'get_node_output',
  'get_timeline',
  'set_keyframe',
  'delete_keyframe',
  'set_playback_position',
  'export_video',
  'get_export_status',
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
      'export_video',
      'run_code',
      'set_keyframe',
      'set_playback_position',
      'write_file',
    ])
  })

  it('gates only run_code on availability', () => {
    // Everything else must be unconditionally available, or WebMCP and the router
    // would quietly disagree about the surface depending on how they were reached
    const gated = toolDefinitions.filter(d => d.available).map(d => d.name)
    expect(gated).toEqual(['run_code'])
  })

  it('keeps only the export tools out of the in-app chat', () => {
    const external = toolDefinitions.filter(d => d.audience === 'external').map(d => d.name)
    expect(external.sort()).toEqual(['export_video', 'get_export_status'])
  })

  it('hides external-only tools from chat lookups unless asked for', () => {
    // The defaults are the chat's view, so discovery and dispatch in agent/ both miss them
    expect(getToolDefinition('export_video')).toBeUndefined()
    expect(availableToolDefinitions().some(d => d.name === 'export_video')).toBe(false)

    expect(getToolDefinition('export_video', { includeExternal: true })?.name).toBe('export_video')
    const all = availableToolDefinitions({ includeExternal: true }).map(d => d.name)
    expect(all).toContain('export_video')
    expect(all).toContain('get_export_status')
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

  it('runs analyze_project on the document, without a project passed in', async () => {
    const analyzeProject = vi.fn(async () => ({ success: true }))
    const tools = { analyzeProject } as unknown as MCPTools
    const definition = getToolDefinition('analyze_project')
    if (!definition) throw new Error('analyze_project not defined')
    const result = await definition.execute(tools, {}, () => null)
    expect(result.success).toBe(true)
    expect(analyzeProject).toHaveBeenCalled()
  })
})
