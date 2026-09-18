import type { DocsIndex, DocTopic } from './types'

const STOP_WORDS = new Set([
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
  'this',
  'that',
])
const CHUNK_CHARS = 1200
const EXCERPT_CHARS = 600
const K1 = 1.2
const B = 0.75

interface DocChunk {
  topic: DocTopic
  heading?: string
  anchor?: string
  text: string
  terms: Map<string, number>
  length: number
}

interface SearchIndex {
  chunks: DocChunk[]
  documentFrequency: Map<string, number>
  averageLength: number
}

const cache = new WeakMap<DocsIndex, SearchIndex>()

export interface DocumentationSearchResult {
  id: string
  title: string
  section: DocTopic['section']
  file: string
  url: string | null
  heading?: string
  headings: string[]
  excerpt: string
  fullLength: number
  score: number
}

export function searchDocumentation(
  docs: DocsIndex,
  query: string,
  section?: DocTopic['section'],
  limit = 5
): DocumentationSearchResult[] {
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []
  const index = cache.get(docs) ?? buildIndex(docs)
  cache.set(docs, index)

  return index.chunks
    .filter(chunk => !section || chunk.topic.section === section)
    .map(chunk => ({ chunk, score: bm25(chunk, queryTerms, index) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.topic.id.localeCompare(b.chunk.topic.id))
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      id: chunk.topic.id,
      title: chunk.topic.title,
      section: chunk.topic.section,
      file: chunk.topic.file,
      url: withAnchor(chunk.topic.url, chunk.anchor),
      heading: chunk.heading,
      headings: chunk.topic.headings.map(heading => heading.text),
      excerpt: compactExcerpt(chunk.text, queryTerms),
      fullLength: chunk.topic.content.length,
      score: Number(score.toFixed(3)),
    }))
}

function buildIndex(docs: DocsIndex): SearchIndex {
  if (docs.searchIndex && docs.searchIndex.chunks.length > 0) {
    const chunks = docs.searchIndex.chunks.flatMap(chunk => {
      const topic = docs.topics[chunk.topicId]
      return topic
        ? [
            {
              ...chunk,
              topic,
              text: topic.content.slice(chunk.start, chunk.end),
              terms: new Map(chunk.terms),
            },
          ]
        : []
    })
    return {
      chunks,
      documentFrequency: new Map(docs.searchIndex.documentFrequency),
      averageLength: docs.searchIndex.averageLength,
    }
  }
  const chunks = Object.values(docs.topics).flatMap(chunkTopic)
  const documentFrequency = new Map<string, number>()
  for (const chunk of chunks) {
    for (const term of chunk.terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }
  const averageLength =
    chunks.reduce((sum, chunk) => sum + chunk.length, 0) / Math.max(1, chunks.length)
  return { chunks, documentFrequency, averageLength }
}

function chunkTopic(topic: DocTopic): DocChunk[] {
  const sections = topic.content.split(/(?=^#{1,6}\s+)/m)
  const chunks: DocChunk[] = []
  for (const section of sections) {
    const headingMatch = section.match(/^#{1,6}\s+(.+)$/m)
    const heading = headingMatch?.[1]
    const anchor = topic.headings.find(candidate => candidate.text === heading)?.anchor
    const paragraphs = section.split(/\n\s*\n/)
    let current = ''
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length > CHUNK_CHARS) {
        chunks.push(makeChunk(topic, heading, anchor, current))
        current = ''
      }
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
    if (current.trim()) chunks.push(makeChunk(topic, heading, anchor, current))
  }
  return chunks
}

function makeChunk(
  topic: DocTopic,
  heading: string | undefined,
  anchor: string | undefined,
  text: string
): DocChunk {
  const weighted = `${topic.title} ${topic.title} ${topic.title} ${heading ?? ''} ${heading ?? ''} ${text}`
  const tokens = tokenize(weighted)
  const terms = new Map<string, number>()
  for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1)
  return { topic, heading, anchor, text, terms, length: tokens.length }
}

function bm25(chunk: DocChunk, queryTerms: string[], index: SearchIndex) {
  let score = 0
  for (const term of new Set(queryTerms)) {
    const frequency = chunk.terms.get(term) ?? 0
    if (frequency === 0) continue
    const documentFrequency = index.documentFrequency.get(term) ?? 0
    const inverseFrequency = Math.log(
      1 + (index.chunks.length - documentFrequency + 0.5) / (documentFrequency + 0.5)
    )
    const normalized = frequency + K1 * (1 - B + B * (chunk.length / index.averageLength))
    score += inverseFrequency * ((frequency * (K1 + 1)) / normalized)
  }
  return score
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 1 && !STOP_WORDS.has(term))
}

function compactExcerpt(text: string, queryTerms: string[]) {
  const compact = text.replace(/\n{3,}/g, '\n\n').trim()
  if (compact.length <= EXCERPT_CHARS) return compact
  const lower = compact.toLowerCase()
  const match = queryTerms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0]
  const start = Math.max(0, (match ?? 0) - Math.floor(EXCERPT_CHARS / 2))
  const excerpt = compact.slice(start, start + EXCERPT_CHARS)
  return `${start > 0 ? '…' : ''}${excerpt}${start + EXCERPT_CHARS < compact.length ? '…' : ''}`
}

function withAnchor(url: string | null, anchor: string | undefined) {
  return url && anchor ? `${url}#${anchor}` : url
}
