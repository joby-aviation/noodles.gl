// BM25 passage search over the docs index, for get_documentation.
//
// Topics are split into passages at headings (and again past CHUNK_CHARS), and
// each passage is scored on its own. Scoring whole pages let the longest ones
// win by mentioning every word somewhere, and the excerpt then had to guess
// where on the page the answer was. A passage carries its own heading anchor, so
// the link points at the section rather than the top of the page.
//
// The index is built on the first query and cached per DocsIndex. The docs are a
// couple of hundred kilobytes of markdown, so this takes milliseconds and saves
// shipping a serialized index in the bundle.

import type { DocsIndex, DocTopic } from './types'

// Words too common in a docs query to discriminate between topics
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
  'best',
  'any',
  'some',
  'this',
  'that',
])
const CHUNK_CHARS = 1200
const EXCERPT_CHARS = 600
// The usual BM25 constants: term-frequency saturation and length normalization
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

// The best passage from each of the top `limit` topics. One per topic, so a long
// page cannot fill every slot, and the id is what a follow-up call fetches.
export function searchDocumentation(
  docs: DocsIndex,
  query: string,
  section?: DocTopic['section'],
  limit = 5
): DocumentationSearchResult[] {
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []
  let index = cache.get(docs)
  if (!index) {
    index = buildIndex(docs)
    cache.set(docs, index)
  }

  const seen = new Set<string>()
  const results: DocumentationSearchResult[] = []
  const ranked = index.chunks
    .filter(chunk => !section || chunk.topic.section === section)
    .map(chunk => ({ chunk, score: bm25(chunk, queryTerms, index) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.topic.id.localeCompare(b.chunk.topic.id))

  for (const { chunk, score } of ranked) {
    if (seen.has(chunk.topic.id)) continue
    seen.add(chunk.topic.id)
    results.push({
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
    })
    if (results.length === limit) break
  }
  return results
}

function buildIndex(docs: DocsIndex): SearchIndex {
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
  // Headings are matched in document order, so a repeated heading (every
  // changelog month has `### Added`) takes its own occurrence's anchor
  let nextHeading = 0
  for (const section of sections) {
    const heading = section.match(/^#{1,6}\s+(.+)$/m)?.[1]
    let anchor: string | undefined
    if (heading !== undefined) {
      const found = topic.headings.findIndex(
        (candidate, i) => i >= nextHeading && candidate.text === heading
      )
      if (found >= 0) {
        anchor = topic.headings[found].anchor
        nextHeading = found + 1
      }
    }
    let current = ''
    for (const paragraph of section.split(/\n\s*\n/)) {
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

// The title counts three times and the heading twice, so a passage under a
// matching heading on a matching page outranks a passing mention elsewhere
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

// Each word also yields its camelCase parts and their leading runs, so
// `ScatterPlotLayerOp` matches "scatterplot", "plot", "ScatterPlotLayer" and
// its full name. The old substring search found these; exact BM25 terms do not.
function tokenize(value: string) {
  const terms: string[] = []
  for (const word of value.split(/[^A-Za-z0-9]+/)) {
    for (const term of wordTerms(word)) {
      if (term.length > 1 && !STOP_WORDS.has(term)) terms.push(term)
    }
  }
  return terms
}

const CAMEL_PART = /[A-Z]+[0-9]*(?![a-z])|[A-Z]?[a-z]+[0-9]*|[0-9]+/g

function wordTerms(word: string) {
  const terms = new Set([word.toLowerCase()])
  const parts = (word.match(CAMEL_PART) ?? []).map(part => part.toLowerCase())
  if (parts.length < 2) return terms
  let prefix = ''
  for (const part of parts) {
    terms.add(part)
    prefix += part
    terms.add(prefix)
  }
  return terms
}

// A window centred on the first query term, so the excerpt shows why it matched
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
