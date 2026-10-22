// Canonical tool definitions shared by the in-app chat (agent/) and the WebMCP
// registration (src/webmcp/). Single source of truth so the provider input_schema
// and the navigator.modelContext inputSchema can't drift.

import { safeMode } from '../noodles/globals'
import type {
  GrepFilesParams,
  ListFilesParams,
  ReadFileParams,
  WriteFileParams,
} from './agent-files'
import type { ExportStatusParams, ExportVideoParams } from './export-video'
import type { MCPTools } from './mcp-tools'
import type { RunCodeParams } from './run-code'
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
  // Omitted means always available. Only run_code sets it: safe mode exists to stop
  // the app executing arbitrary code, so the tool has to disappear rather than be
  // offered and then refuse. Read through getToolDefinition and
  // availableToolDefinitions, never off the raw array.
  available?: () => boolean
  // 'external' registers the tool on WebMCP only and keeps it out of the in-app chat.
  // Omitted means both. Only export_video and get_export_status set it: the person
  // in the chat is one click from the Export button, and a multi-minute render the
  // model starts on its own would take over the canvas and playhead under them.
  audience?: 'external'
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
    description:
      'Get deck.gl rendering statistics: frames drawn in the last second (fps), the time between the last two frames, layer count and JS memory. fps counts frames actually drawn, so a still scene that nothing is animating or redrawing reads 0; that is not a performance problem.',
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
      "Edit the document; a batch applies whole as one undo step, or not at all. add_node {op, name, params}; update_node {id, params} merges (null reverts); delete_node {id}; add_edge {source, sourcePort, target, targetPort}, a targetPort of 'par:<param>' drives a parameter; delete_edge {source, target}. Nodes by id or name.",
    inputSchema: {
      type: 'object',
      properties: {
        modifications: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge'],
              },
              id: { type: 'string' },
              op: { type: 'string' },
              name: { type: 'string' },
              params: { type: 'object' },
              source: { type: 'string' },
              sourcePort: { type: 'string' },
              target: { type: 'string' },
              targetPort: { type: 'string' },
            },
            required: ['type'],
          },
        },
      },
      required: ['modifications'],
    },
    execute: (tools, params) => tools.applyModifications(params as { modifications: unknown[] }),
  },
  {
    name: 'run_code',
    annotations: { readOnlyHint: false, destructiveHint: true },
    // This description is what find_tools scores against, so it names the libraries
    // by the identifiers they are bound to — that is how a query like "compute a
    // distance" or "check the shape of the data" reaches it.
    description:
      "Run JavaScript against the live graph and get the value back. The same sandbox CodeOp uses: op('/node-id').out.data and .par.field read any operator's output or input, and d3, turf, deck, Plot, Temporal, utils and every operator class are in scope, plus sequenceTime, frame, totalFrames and sequence. Use it to compute a statistic, inspect the shape of a dataset, test a transform before committing it to a CodeOp, or check what an accessor would return. Return a value to see it; console.log is captured too. Large results come back as a sample with a length. Runs on the main thread, so no unbounded loops. Use apply_modifications to add or remove nodes — this tool is for computing and reading.",
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript function body. Use return to produce a value; await is allowed.',
        },
        timeoutMs: {
          type: 'number',
          description: 'How long to wait on an async result (default 10000, max 60000)',
        },
      },
      required: ['code'],
    },
    available: () => !safeMode,
    execute: (tools, params) => tools.runCode(params as unknown as RunCodeParams),
  },
  // Project data directory. Reads reach the whole directory; writes only @/.agent/
  {
    name: 'list_files',
    annotations: { readOnlyHint: true },
    description:
      "List the data files in the project's data directory — the CSV, JSON and GeoJSON files its FileOp and DuckDbOp nodes load, referenced as @/name.csv. Use it to find out what data a project actually has before assuming a file name. Pass path to list one subdirectory.",
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Subdirectory to list, relative to the data directory. Omit for all files.',
        },
        maxResults: { type: 'number', description: 'Default 200' },
      },
    },
    execute: (tools, params) => tools.listFiles(params as ListFilesParams),
  },
  {
    name: 'read_file',
    annotations: { readOnlyHint: true },
    description:
      'Read a text file from the project data directory: a CSV header and rows, a GeoJSON, a config. Accepts @/name.csv or name.csv. Small files come back whole; a large one comes back as a line count plus head and tail, and startLine/endLine page through it. For computing over a whole large file, use run_code instead of reading it into the conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, e.g. @/trips.csv or .agent/joined.csv' },
        startLine: { type: 'number', description: '1-based, inclusive' },
        endLine: { type: 'number', description: '1-based, inclusive' },
      },
      required: ['path'],
    },
    execute: (tools, params) => tools.readFile(params as unknown as ReadFileParams),
  },
  {
    name: 'write_file',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      "Write a text file into the project's scratch directory, @/.agent/. Use it to save a derived dataset — a joined or aggregated CSV, a GeoJSON you generated in run_code — then point a FileOp's url at the returned @/.agent/… path to bring it into the graph. Writes are only allowed inside @/.agent/; the project's own input data is read-only, so this can never overwrite a source dataset. Replacing a scratch file keeps the old contents at @/.agent/.previous/.",
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path inside the scratch directory, e.g. .agent/joined.csv',
        },
        content: { type: 'string', description: 'Full file contents' },
      },
      required: ['path', 'content'],
    },
    execute: (tools, params) => tools.writeFile(params as unknown as WriteFileParams),
  },
  {
    name: 'grep_files',
    annotations: { readOnlyHint: true },
    description:
      'Search the project data files for a JavaScript regular expression and get back matching lines with file and line number. Use it to find which file holds a column or a value, or to check whether a dataset contains something, without reading whole files into the conversation. Binary and very large files are skipped and reported.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression source' },
        path: { type: 'string', description: 'Limit to a subdirectory of the data directory' },
        contextLines: { type: 'number', description: 'Lines of context each side, 0-5' },
        maxResults: { type: 'number', description: 'Default 20, max 40' },
        ignoreCase: { type: 'boolean' },
      },
      required: ['pattern'],
    },
    execute: (tools, params) => tools.grepFiles(params as unknown as GrepFilesParams),
  },
  {
    name: 'get_current_project',
    annotations: { readOnlyHint: true },
    description:
      'Get the whole document: every node with all its parameters, every wire, and which parameters are keyframed',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.getCurrentProject(),
  },
  {
    name: 'list_nodes',
    annotations: { readOnlyHint: true },
    description: "List the document's nodes (operator, parameters, errors) and wires",
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.listNodes(),
  },
  {
    name: 'get_node_info',
    annotations: { readOnlyHint: true },
    description:
      'Get one node in full: every parameter with its kind, default and current value, its ports, its wires, which parameters are keyframed, how many rows it drew, and its errors',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The node id or name' },
      },
      required: ['nodeId'],
    },
    execute: (tools, params) => tools.getNodeInfo(params as { nodeId: string }),
  },
  {
    name: 'get_node_output',
    annotations: { readOnlyHint: true },
    description:
      'The rows a node makes: columns, count and a sample. Check column names here before writing expressions',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The node id or name' },
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
      "Get the animation timeline: length, frame rate, playback position, and each keyframed parameter ('node.param') with its keyframes. Use this before adding keyframes.",
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
      "Add or update a keyframe on a number parameter: target is 'node.param' (e.g. 'dots.opacity'), time is in seconds, interpolation is bezier (smooth), linear or hold (step). A keyframe already at that time is updated.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "The parameter, as 'node.param'" },
        time: { type: 'number', description: 'Time in seconds' },
        value: { type: 'number', description: 'The value at that time' },
        interpolation: {
          type: 'string',
          enum: ['bezier', 'linear', 'hold'],
          description: 'How the value moves to the next keyframe (default: bezier)',
        },
      },
      required: ['target', 'time', 'value'],
    },
    execute: (tools, params) => tools.setKeyframe(params as Parameters<MCPTools['setKeyframe']>[0]),
  },
  {
    name: 'delete_keyframe',
    annotations: { readOnlyHint: false, destructiveHint: true },
    description:
      "Delete a keyframe from a parameter's track, by its id or its time. Use get_timeline to find them.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "The parameter, as 'node.param'" },
        keyframeId: { type: 'string', description: 'The keyframe id' },
        time: { type: 'number', description: 'Or the keyframe time, in seconds' },
      },
      required: ['target'],
    },
    execute: (tools, params) =>
      tools.deleteKeyframe(params as Parameters<MCPTools['deleteKeyframe']>[0]),
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
  // Export tools, external clients only (see audience)
  {
    name: 'export_video',
    audience: 'external',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      "Render the timeline to an MP4 video, the same as the Export button. Omitted settings come from the project's render settings, and the range defaults to the timeline in/out points, then its full length. The file is saved to @/.agent/renders/ in the project (confirm with list_files) and, with download: true, also downloaded by the browser. Rendering moves the playhead and takes over the canvas until it finishes. The call waits up to waitSeconds (max 20) and then returns progress if the render is still going; call get_export_status to keep waiting.",
    inputSchema: {
      type: 'object',
      properties: {
        startTime: { type: 'number', description: 'Start of the range in seconds' },
        endTime: { type: 'number', description: 'End of the range in seconds' },
        fps: { type: 'number', description: 'Frames per second, 1-120' },
        width: { type: 'number', description: 'Output width in pixels, even' },
        height: { type: 'number', description: 'Output height in pixels, even' },
        codec: {
          type: 'string',
          enum: ['avc', 'hevc', 'vp9', 'av1'],
          description: 'Video codec in the MP4 container. avc (H.264) plays everywhere.',
        },
        download: {
          type: 'boolean',
          description: "Also save the file to the browser's downloads folder (default false)",
        },
        waitSeconds: {
          type: 'number',
          description:
            'How long to wait for the render before returning progress, 0-20 (default 20)',
        },
      },
    },
    execute: (tools, params) => tools.exportVideo(params as ExportVideoParams),
  },
  {
    name: 'get_export_status',
    audience: 'external',
    annotations: { readOnlyHint: true },
    description:
      'Wait for the video export started by export_video and report its progress, or the finished file: name, project path, byte size, frame count and duration.',
    inputSchema: {
      type: 'object',
      properties: {
        waitSeconds: {
          type: 'number',
          description:
            'How long to wait for the render to finish before returning progress, 0-20 (default 20)',
        },
      },
    },
    execute: (tools, params) => tools.getExportStatus(params as ExportStatusParams),
  },
  // Context tools (code search, docs, examples). The chat reaches these through
  // find_tools rather than paying for their schemas up front — see agent/tool-router.ts
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
    execute: (tools, params) =>
      tools.getSourceCode(params as { file: string; startLine?: number; endLine?: number }),
  },
  {
    name: 'get_operator_schema',
    annotations: { readOnlyHint: true },
    description:
      "Get an operator type's ports and parameters (name, kind, default, options), e.g. 'scatter', 'attribute', 'file'",
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Operator type name' },
      },
      required: ['type'],
    },
    execute: (tools, params) => tools.getOperatorSchema(params as { type: string }),
  },
  {
    name: 'list_operators',
    annotations: { readOnlyHint: true },
    description:
      'List the operator types a document can use, optionally by category (data, table, rows, color, layer, number, output, host)',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by operator category' },
      },
    },
    execute: (tools, params) => tools.listOperators(params as { category?: string }),
  },
  {
    name: 'get_documentation',
    annotations: { readOnlyHint: true },
    // Deliberately does not enumerate the available topics: this description is
    // what find_tools scores against, and a list of every subject would match
    // almost any query and crowd out the specific tool the model actually needs.
    // core.md carries the topic list instead.
    description:
      'Search the Noodles.gl documentation and step-by-step workflow guides. Searching returns excerpts with topic ids and noodles.gl URLs for linking; pass an id to read that topic in full.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to know about' },
        id: {
          type: 'string',
          description: 'Id of a topic from a previous search, to read it in full',
        },
        section: {
          type: 'string',
          enum: ['users', 'developers', 'ai-assistant', 'examples'],
          description: 'Limit search to a docs section',
        },
      },
    },
    execute: (tools, params) =>
      tools.getDocumentation(
        params as {
          query?: string
          id?: string
          section?: 'users' | 'developers' | 'ai-assistant' | 'examples'
        }
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
    execute: (tools, params) => tools.findSymbol(params as { name: string }),
  },
  {
    name: 'analyze_project',
    annotations: { readOnlyHint: true },
    description:
      'Check the document for problems: nodes that failed to lower or query, host operator errors, unknown operators, and nodes nothing reads',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: tools => tools.analyzeProject(),
  },
]

const definitionsByName = new Map(toolDefinitions.map(d => [d.name, d]))

// Both lookups default to the chat's view, so code in agent/ cannot reach an
// external-only tool by forgetting an option. WebMCP passes includeExternal.
interface SurfaceOptions {
  includeExternal?: boolean
}

function isOffered(definition: ToolDefinition, { includeExternal = false }: SurfaceOptions) {
  if (definition.available?.() === false) return false
  return includeExternal || definition.audience !== 'external'
}

// The gate has to sit here rather than only on discovery: the agent loop dispatches
// by name and runs a tool the model was never offered, on the reasoning that the
// definition is real and the call is well-formed. Returning undefined turns that
// into "Unknown tool", and makes isReadOnly fall back to treating it as mutating.
export function getToolDefinition(
  name: string,
  options: SurfaceOptions = {}
): ToolDefinition | undefined {
  const definition = definitionsByName.get(name)
  if (!definition || !isOffered(definition, options)) return undefined
  return definition
}

// Every tool currently on offer. Use this for listing and scoring; the raw
// toolDefinitions array includes tools that are unavailable in this session.
export function availableToolDefinitions(options: SurfaceOptions = {}): ToolDefinition[] {
  return toolDefinitions.filter(d => isOffered(d, options))
}
