// Documentation URL builder
// Converts file paths to hosted documentation URLs at noodles.gl

import type { DocTopic } from './types'

export interface DocUrlConfig {
  baseUrl: string
  routeBasePath: string
}

const DEFAULT_CONFIG: DocUrlConfig = {
  baseUrl: 'https://noodles.gl',
  routeBasePath: '/',
}

/**
 * Builds a documentation URL from a file path and optional anchor
 *
 * @param file - Relative file path (e.g., "users/ai-assistant.md")
 * @param section - Doc section to determine if URL should be generated
 * @param anchor - Optional heading anchor (e.g., "basic-usage")
 * @returns Full URL or null if not publicly hosted
 *
 * Examples:
 * - "users/ai-assistant.md" -> "https://noodles.gl/users/ai-assistant"
 * - "intro.md" -> "https://noodles.gl/intro"
 * - "ai-chat/workflow-timeline.md" -> null (internal docs)
 */
export function buildDocUrl(
  file: string,
  section: DocTopic['section'],
  anchor?: string
): string | null {
  // AI assistant internal docs and example READMEs aren't published to the website
  if (section === 'ai-assistant') {
    return null
  }

  // Examples are embedded in the app, not on the docs site
  if (section === 'examples') {
    return null
  }

  // Remove .md extension and construct path
  const urlPath = file.replace(/\.md$/, '')

  // Construct full URL
  const { baseUrl, routeBasePath } = DEFAULT_CONFIG
  const base = baseUrl.replace(/\/$/, '')
  const route = routeBasePath === '/' ? '' : routeBasePath.replace(/\/$/, '')
  const path = urlPath.startsWith('/') ? urlPath : `/${urlPath}`
  const hash = anchor ? `#${anchor}` : ''

  return `${base}${route}${path}${hash}`
}
