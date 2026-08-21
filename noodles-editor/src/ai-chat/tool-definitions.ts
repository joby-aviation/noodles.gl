// Canonical tool definitions shared by the in-app Claude chat (claude-client.ts)
// and the WebMCP registration (src/webmcp/). Single source of truth so the
// Anthropic input_schema and the navigator.modelContext inputSchema can't drift.

import type { MCPTools } from './mcp-tools'
import type { NoodlesProject, SearchCodeParams, ToolResult } from './types'

// JSON Schema subset accepted by both Anthropic tools and WebMCP registerTool
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

// Behavior hints per the MCP/WebMCP ToolAnnotations spec. MCP clients use
// these to decide which calls to auto-approve vs surface to the user, so
// every definition must declare them — a new mutating tool can't silently
// pass for read-only
export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
}

export interface ToolDefinition {
  // snake_case, matches the in-app chat tool names
  name: string
  description: string
  annotations: ToolAnnotations
  inputSchema: ToolInputSchema
  // false = executable but not offered to the in-app chat (keeps chat token budget unchanged)
  exposeToChat?: boolean
  // getProject supplies the live project for tools that need it injected (analyze_project)
  execute: (
    tools: MCPTools,
    params: Record<string, unknown>,
    getProject: () => NoodlesProject | null
  ) => Promise<ToolResult> | ToolResult
}

export const toolDefinitions: ToolDefinition[] = [
  // Visual debugging tools
  {
    name: 'capture_visualization',
    annotations: { readOnlyHint: true },
    description:
      'Capture a screenshot of the current visualization. The screenshot will be attached to your next message so you can see it.',
    inputSchema: {
      type: 'object',
      properties: {
        includeUI: { type: 'boolean' },
        format: { type: 'string', enum: ['png', 'jpeg'] },
        quality: { type: 'number', description: 'JPEG quality 0-1, default 0.7' },
      },
    },
    execute: (tools, params) =>
      tools.captureVisualization(
        params as { includeUI?: boolean; format?: 'png' | 'jpeg'; quality?: number }
      ),
  },
  {
    name: 'get_console_errors',
    annotations: { readOnlyHint: true },
    description: 'Get recent browser console errors and warnings',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number' },
        level: { type: 'string', enum: ['error', 'warn', 'all'] },
        maxResults: { type: 'number' },
      },
    },
    execute: (tools, params) =>
      tools.getConsoleErrors(
        params as { since?: number; level?: 'error' | 'warn' | 'all'; maxResults?: number }
      ),
  },
  {
    name: 'get_render_stats',
    annotations: { readOnlyHint: true },
    description: 'Get deck.gl rendering statistics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.getRenderStats(),
  },
  {
    name: 'inspect_layer',
    annotations: { readOnlyHint: true },
    description: 'Get layer information',
    inputSchema: {
      type: 'object',
      properties: {
        layerId: { type: 'string' },
      },
      required: ['layerId'],
    },
    execute: (tools, params) => tools.inspectLayer(params as { layerId: string }),
  },
  // Project state tools
  {
    name: 'apply_modifications',
    annotations: { readOnlyHint: false, destructiveHint: true },
    description:
      'Apply modifications to the project (add/update/delete nodes or edges). Use this instead of returning JSON in text.',
    inputSchema: {
      type: 'object',
      properties: {
        modifications: {
          type: 'array',
          description: 'Array of modifications to apply',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge'],
              },
              data: {
                type: 'object',
                description: 'The node or edge data',
              },
            },
            required: ['type', 'data'],
          },
        },
      },
      required: ['modifications'],
    },
    // biome-ignore lint/suspicious/noExplicitAny: dynamic modification structure from Claude
    execute: (tools, params) => tools.applyModifications(params as { modifications: any[] }),
  },
  {
    name: 'get_current_project',
    annotations: { readOnlyHint: true },
    description: 'Get the current project state including all nodes and edges',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.getCurrentProject(),
  },
  {
    name: 'list_nodes',
    annotations: { readOnlyHint: true },
    description: 'List all nodes in the project with their current state and execution status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.listNodes(),
  },
  {
    name: 'get_node_info',
    annotations: { readOnlyHint: true },
    description: 'Get detailed information about a specific node including connections and schema',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The ID of the node to inspect' },
      },
      required: ['nodeId'],
    },
    execute: (tools, params) => tools.getNodeInfo(params as { nodeId: string }),
  },
  {
    name: 'get_node_output',
    annotations: { readOnlyHint: true },
    description:
      'Read the output data from a specific operator/node. Useful for inspecting data at any point in the pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The ID of the node to read output from' },
        maxRows: {
          type: 'number',
          description: 'Maximum number of rows to return (default: 10)',
        },
      },
      required: ['nodeId'],
    },
    execute: (tools, params) => tools.getNodeOutput(params as { nodeId: string; maxRows?: number }),
  },
  // Timeline tools
  {
    name: 'get_timeline',
    annotations: { readOnlyHint: true },
    description:
      'Get the current animation timeline state: sequence length, FPS, playback position, and all animated tracks with their keyframes. Use this before adding keyframes to understand the current animation.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.getTimeline(),
  },
  {
    name: 'set_keyframe',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description:
      'Add or update a keyframe on an animated field. Track IDs follow the pattern "operator-name / fieldName" (e.g. "my-layer / opacity"). Position is in seconds. Interpolation is "bezier" (smooth) or "hold" (step). If a keyframe already exists within 1 frame of the position, it will be updated.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: {
          type: 'string',
          description: 'Track identifier in format "operator-name / fieldName"',
        },
        position: { type: 'number', description: 'Time position in seconds' },
        value: { description: 'The value at this keyframe (number, boolean, or string)' },
        interpolation: {
          type: 'string',
          enum: ['bezier', 'hold'],
          description: 'Interpolation type (default: bezier)',
        },
      },
      required: ['trackId', 'position', 'value'],
    },
    execute: (tools, params) =>
      tools.setKeyframe(
        params as {
          trackId: string
          position: number
          value: number | boolean | string
          interpolation?: 'bezier' | 'hold'
        }
      ),
  },
  {
    name: 'delete_keyframe',
    annotations: { readOnlyHint: false, destructiveHint: true },
    description: 'Delete a specific keyframe by its ID. Use get_timeline to find keyframe IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'The track containing the keyframe' },
        keyframeId: { type: 'string', description: 'The keyframe ID to delete' },
      },
      required: ['trackId', 'keyframeId'],
    },
    execute: (tools, params) =>
      tools.deleteKeyframe(params as { trackId: string; keyframeId: string }),
  },
  {
    name: 'set_playback_position',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description:
      'Scrub the timeline to a specific time position (in seconds) for inspection. Optionally start or stop playback.',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'number', description: 'Time in seconds to seek to' },
        play: {
          type: 'boolean',
          description: 'true to start playback, false to pause, omit to leave unchanged',
        },
      },
      required: ['position'],
    },
    execute: (tools, params) =>
      tools.setPlaybackPosition(params as { position: number; play?: boolean }),
  },
  // Context tools (code search, docs, examples) — executable by the chat's tool
  // loop and WebMCP, but not offered in the chat's tool list to save tokens
  {
    name: 'search_code',
    annotations: { readOnlyHint: true },
    description:
      'Search the Noodles.gl source code with a regex pattern. Returns matching lines with surrounding context.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Only search files whose path contains this string' },
        contextLines: {
          type: 'number',
          description: 'Lines of context around each match (default: 3)',
        },
        maxResults: { type: 'number', description: 'Maximum matches to return (default: 20)' },
      },
      required: ['pattern'],
    },
    exposeToChat: false,
    execute: (tools, params) => tools.searchCode(params as unknown as SearchCodeParams),
  },
  {
    name: 'get_source_code',
    annotations: { readOnlyHint: true },
    description: 'Get source code for a specific file, optionally limited to a line range',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path within the code index' },
        startLine: { type: 'number', description: '1-indexed first line (default: 1)' },
        endLine: { type: 'number', description: '1-indexed last line (default: end of file)' },
      },
      required: ['file'],
    },
    exposeToChat: false,
    execute: (tools, params) =>
      tools.getSourceCode(params as { file: string; startLine?: number; endLine?: number }),
  },
  {
    name: 'get_operator_schema',
    annotations: { readOnlyHint: true },
    description:
      'Get the input/output field schema for an operator type (e.g. FileOp, ScatterplotLayerOp)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Operator type name' },
      },
      required: ['type'],
    },
    exposeToChat: false,
    execute: (tools, params) => tools.getOperatorSchema(params as { type: string }),
  },
  {
    name: 'list_operators',
    annotations: { readOnlyHint: true },
    description: 'List all available operator types, optionally filtered by category',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by operator category' },
      },
    },
    exposeToChat: false,
    execute: (tools, params) => tools.listOperators(params as { category?: string }),
  },
  {
    name: 'get_documentation',
    annotations: { readOnlyHint: true },
    description: 'Search the Noodles.gl documentation',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        section: {
          type: 'string',
          enum: ['users', 'developers', 'ai-assistant', 'examples'],
          description: 'Limit search to a docs section',
        },
      },
      required: ['query'],
    },
    exposeToChat: false,
    execute: (tools, params) =>
      tools.getDocumentation(
        params as { query: string; section?: 'users' | 'developers' | 'ai-assistant' | 'examples' }
      ),
  },
  {
    name: 'get_example',
    annotations: { readOnlyHint: true },
    description: 'Get an example project by ID, including its full node graph',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Example project ID' },
      },
      required: ['id'],
    },
    exposeToChat: false,
    execute: (tools, params) => tools.getExample(params as { id: string }),
  },
  {
    name: 'list_examples',
    annotations: { readOnlyHint: true },
    description: 'List all example projects, optionally filtered by category or tag',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category' },
        tag: { type: 'string', description: 'Filter by tag' },
      },
    },
    exposeToChat: false,
    execute: (tools, params) => tools.listExamples(params as { category?: string; tag?: string }),
  },
  {
    name: 'find_symbol',
    annotations: { readOnlyHint: true },
    description: 'Find a symbol (class, function, type) by name in the Noodles.gl source code',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to find' },
      },
      required: ['name'],
    },
    exposeToChat: false,
    execute: (tools, params) => tools.findSymbol(params as { name: string }),
  },
  {
    name: 'analyze_project',
    annotations: { readOnlyHint: true },
    description: 'Analyze the current project for validation issues or performance problems',
    inputSchema: {
      type: 'object',
      properties: {
        analysisType: {
          type: 'string',
          enum: ['validation', 'performance', 'suggestions'],
          description: 'Type of analysis to run',
        },
      },
      required: ['analysisType'],
    },
    exposeToChat: false,
    execute: (tools, params, getProject) => {
      const project = getProject()
      if (!project) {
        return { success: false, error: 'No project loaded' }
      }
      return tools.analyzeProject({
        project,
        analysisType: params.analysisType as 'validation' | 'performance' | 'suggestions',
      })
    },
  },
]

const definitionsByName = new Map(toolDefinitions.map(d => [d.name, d]))

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return definitionsByName.get(name)
}
