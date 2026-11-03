// Converts a tool result into the MCP CallToolResult shape. Shared by the two
// paths that hand the editor's tools to an outside agent: WebMCP
// (src/webmcp/register.ts) and an ACP agent through the local bridge
// (agent/acp/session.ts).

import { safeStringify } from '../noodles/utils/serialization'
import type { ToolResult } from './types'

export interface ContentBlock {
  type: string
  [key: string]: unknown
}

export interface ToolResponse {
  content: ContentBlock[]
  isError?: boolean
}

// Converts a ToolResult into the WebMCP/MCP CallToolResult shape
export function toToolResponse(toolName: string, result: ToolResult): ToolResponse {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
      isError: true,
    }
  }

  // Screenshots go back as a proper MCP image block; the base64 payload is
  // stripped from the text metadata to keep it readable
  if (toolName === 'capture_visualization' && isScreenshotData(result.data)) {
    const { screenshot, format = 'jpeg', ...meta } = result.data
    return {
      content: [
        { type: 'image', data: screenshot, mimeType: `image/${format}` },
        { type: 'text', text: JSON.stringify({ format, ...meta }) },
      ],
    }
  }

  return {
    content: [{ type: 'text', text: stringifyData(result.data) }],
  }
}

function stringifyData(data: unknown): string {
  // safeStringify sanitizes functions/circular refs but only accepts objects
  if (typeof data === 'object' && data !== null) {
    return safeStringify(data as Record<string, unknown>).trimEnd()
  }
  return JSON.stringify(data) ?? 'null'
}

function isScreenshotData(
  data: unknown
): data is { screenshot: string; format?: 'png' | 'jpeg'; [key: string]: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { screenshot?: unknown }).screenshot === 'string'
  )
}
