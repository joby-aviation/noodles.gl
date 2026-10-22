// The docs the in-app assistant searches (src/ai-chat/runtime-docs-loader.ts),
// read from disk instead of through Vite's import.meta.glob. Ids, sections and
// URLs match, so a topic id from either surface works in both.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type Section = 'intro' | 'users' | 'developers' | 'ai-assistant' | 'examples'

export interface DocTopic {
  id: string
  title: string
  section: Section
  file: string
  url: string | null
  headings: Array<{ level: number; text: string; anchor: string }>
  content: string
}

const DOCS_URL = 'https://noodles.gl'
const MAX_DOC_RESULTS = 5
const DOC_EXCERPT_CHARS = 600

// Words too common in a docs query to discriminate between topics
const DOC_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'in',
  'on',
  'and',
  'or',
  'is',
  'it',
  'how',
  'do',
  'does',
  'can',
  'my',
  'me',
  'with',
  'what',
  'when',
  'why',
  'use',
  'using',
  'noodles',
  'should',
  'would',
  'could',
  'want',
  'need',
  'get',
  'set',
  'make',
  'best',
  'any',
  'some',
  'this',
  'that',
])

export function loadDocs(repoRoot: string): Record<string, DocTopic> {
  const topics: Record<string, DocTopic> = {}
  const add = (topic: DocTopic) => {
    topics[topic.id] = topic
  }

  const docsDir = join(repoRoot, 'docs')
  for (const path of markdownFiles(docsDir)) {
    const file = toPosix(relative(docsDir, path))
    const section: Section = file.startsWith('users/')
      ? 'users'
      : file.startsWith('developers/')
        ? 'developers'
        : 'intro'
    add(topic(path, file.replace(/\.md$/, '').replace(/\//g, '-'), section, file))
  }

  // Skips core.md, the system prompt, and READMEs, as the in-app loader does;
  // CLAUDE.md files only import AGENTS.md
  const chatDir = join(repoRoot, 'noodles-editor/src/ai-chat')
  for (const path of markdownFiles(chatDir)) {
    const rel = toPosix(relative(chatDir, path))
    if (rel === 'prompts/core.md' || rel.endsWith('README.md') || rel.endsWith('CLAUDE.md')) {
      continue
    }
    const id = rel.startsWith('prompts/sections/')
      ? `workflow-${rel.split('/').pop()?.replace(/\.md$/, '')}`
      : `ai-chat-${rel.replace(/\.md$/, '').replace(/\//g, '-')}`
    add(topic(path, id, 'ai-assistant', `ai-chat/${rel}`))
  }

  const examplesDir = join(repoRoot, 'noodles-editor/src/examples')
  for (const name of subdirectories(examplesDir)) {
    const path = join(examplesDir, name, 'README.md')
    if (isFile(path)) add(topic(path, `example-${name}`, 'examples', `examples/${name}/README.md`))
  }

  return topics
}

export function searchDocs(
  topics: Record<string, DocTopic>,
  query: string,
  section?: Section
): Array<
  Omit<DocTopic, 'content' | 'headings'> & {
    headings: string[]
    excerpt: string
    fullLength: number
  }
> {
  return Object.values(topics)
    .filter(t => !section || t.section === section)
    .map(t => ({ t, ...scoreTopic(t, query) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id))
    .slice(0, MAX_DOC_RESULTS)
    .map(({ t, matchIndex }) => ({
      id: t.id,
      title: t.title,
      section: t.section,
      file: t.file,
      url: t.url,
      headings: t.headings.map(h => h.text),
      excerpt: excerptAround(t.content, matchIndex),
      fullLength: t.content.length,
    }))
}

function topic(path: string, id: string, section: Section, file: string): DocTopic {
  const content = readFileSync(path, 'utf8')
  const title = content.match(/^#\s+(.+)$/m)?.[1] ?? 'Untitled'
  // AI assistant docs and example READMEs aren't on the docs site
  const url =
    section === 'ai-assistant' || section === 'examples'
      ? null
      : `${DOCS_URL}/${file.replace(/\.md$/, '')}`
  return { id, title, section, file, url, headings: extractHeadings(content), content }
}

function extractHeadings(content: string): DocTopic['headings'] {
  const headings: DocTopic['headings'] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const text = match[2]
      const anchor = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
      headings.push({ level: match[1].length, text, anchor })
    }
  }
  return headings
}

function docTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 1 && !DOC_STOP_WORDS.has(term))
}

// Same scoring as the in-app get_documentation: per term, title and headings
// weighted over body, presence rather than count, a bonus when every term hits
function scoreTopic(t: DocTopic, query: string): { score: number; matchIndex: number } {
  const terms = docTerms(query)
  if (terms.length === 0) return { score: 0, matchIndex: 0 }

  const title = t.title.toLowerCase()
  const content = t.content.toLowerCase()
  const headings = t.headings.map(h => h.text.toLowerCase())

  let score = 0
  let matchIndex = -1
  for (const term of terms) {
    if (title.includes(term)) score += 8
    if (headings.some(heading => heading.includes(term))) score += 3
    const found = content.indexOf(term)
    if (found !== -1) {
      score += 1
      if (matchIndex === -1 || found < matchIndex) matchIndex = found
    }
  }

  const allTermsPresent = terms.every(
    term => title.includes(term) || content.includes(term) || headings.some(h => h.includes(term))
  )
  if (allTermsPresent && terms.length > 1) score += 4

  return { score, matchIndex: Math.max(0, matchIndex) }
}

// A window of content centred on the match, snapped to line boundaries
function excerptAround(content: string, matchIndex: number): string {
  if (content.length <= DOC_EXCERPT_CHARS) return content

  const half = Math.floor(DOC_EXCERPT_CHARS / 2)
  let start = Math.max(0, matchIndex - half)
  let end = Math.min(content.length, start + DOC_EXCERPT_CHARS)

  const lineStart = content.lastIndexOf('\n', start)
  if (lineStart !== -1 && start - lineStart < 120) start = lineStart + 1

  const lineEnd = content.indexOf('\n', end)
  if (lineEnd !== -1 && lineEnd - end < 120) end = lineEnd

  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  return `${prefix}${content.slice(start, end)}${suffix}`
}

function markdownFiles(dir: string): string[] {
  if (!isDirectory(dir)) return []
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...markdownFiles(path))
    } else if (entry.name.endsWith('.md')) {
      found.push(path)
    }
  }
  return found.sort()
}

export function subdirectories(dir: string): string[] {
  if (!isDirectory(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}
