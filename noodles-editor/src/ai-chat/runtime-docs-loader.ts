// Runtime documentation loader - uses Vite's import.meta.glob for on-demand loading

import type { DocsIndex, DocTopic } from './types'
import { buildDocUrl } from './doc-url-builder'

// Eagerly load all markdown files at startup
// Vite will bundle these, but they're just raw text strings
const mainDocs = import.meta.glob('../../../docs/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const aiChatDocs = import.meta.glob('./**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const exampleReadmes = import.meta.glob('../examples/*/README.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

// Extract headings from markdown content
function extractHeadings(content: string): Array<{ level: number; text: string; anchor: string }> {
  const headings: Array<{ level: number; text: string; anchor: string }> = []
  const lines = content.split('\n')

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2]
      const anchor = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
      headings.push({ level, text, anchor })
    }
  }

  return headings
}

// Parse a markdown file into a DocTopic
function parseDocTopic(modulePath: string, content: string): DocTopic {
  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1] : 'Untitled'

  // Determine section and id based on path
  let section: DocTopic['section']
  let id: string
  let file: string

  if (modulePath.startsWith('./')) {
    // AI chat documentation (from aiChatDocs glob: ./**/*.md)
    section = 'ai-assistant'
    const relativePath = modulePath.slice(2) // Remove './'

    // Prompt sections get workflow-* ids
    if (relativePath.includes('prompts/sections/')) {
      const filename = relativePath.split('/').pop()?.replace(/\.md$/, '') || 'unknown'
      id = `workflow-${filename}`
    } else {
      id = `ai-chat-${relativePath.replace(/\.md$/, '').replace(/\//g, '-')}`
    }
    file = `ai-chat/${relativePath}`
  } else if (modulePath.includes('/docs/')) {
    // Main documentation
    const relativePath = modulePath.split('/docs/')[1]
    if (relativePath.startsWith('users/')) {
      section = 'users'
    } else if (relativePath.startsWith('developers/')) {
      section = 'developers'
    } else {
      section = 'intro'
    }
    id = relativePath.replace(/\.md$/, '').replace(/\//g, '-')
    file = relativePath
  } else if (modulePath.includes('/examples/')) {
    // Example READMEs
    section = 'examples'
    const match = modulePath.match(/\/examples\/([^/]+)\/README\.md/)
    const exampleName = match?.[1] || 'unknown'
    id = `example-${exampleName}`
    file = `examples/${exampleName}/README.md`
  } else {
    section = 'intro'
    id = 'unknown'
    file = 'unknown'
  }

  const headings = extractHeadings(content)
  const url = buildDocUrl(file, section)

  return {
    id,
    title,
    section,
    file,
    url,
    content,
    headings,
    codeExamples: [],
    relatedTopics: [],
  }
}

// Build the docs index (cached after first access)
let docsCache: DocsIndex | null = null

export function getDocsIndex(): DocsIndex {
  if (docsCache) {
    return docsCache
  }

  const topics: Record<string, DocTopic> = {}

  // Parse main docs
  for (const [modulePath, content] of Object.entries(mainDocs)) {
    const topic = parseDocTopic(modulePath, content as string)
    topics[topic.id] = topic
  }

  // Parse AI chat docs (skip core.md - that's the system prompt)
  for (const [modulePath, content] of Object.entries(aiChatDocs)) {
    if (modulePath.includes('/prompts/core.md')) continue
    if (modulePath.endsWith('/README.md')) continue

    const topic = parseDocTopic(modulePath, content as string)
    topics[topic.id] = topic
  }

  // Parse example READMEs
  for (const [modulePath, content] of Object.entries(exampleReadmes)) {
    const topic = parseDocTopic(modulePath, content as string)
    topics[topic.id] = topic
  }

  docsCache = {
    version: '1.0.0',
    topics,
  }

  return docsCache
}
