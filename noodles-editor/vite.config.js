import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const ENV_VARIABLES_WITH_INSTRUCTIONS = {
  VITE_GOOGLE_MAPS_API_KEY:
    'Get token at https://developers.google.com/maps/documentation/javascript/get-api-key',
  VITE_CESIUM_ACCESS_TOKEN: 'Get token at https://cesium.com/ion/tokens',
  VITE_MAPBOX_ACCESS_TOKEN: 'Get token at https://account.mapbox.com/access-tokens/',
  VITE_MAPTILER_API_KEY: 'Get token at https://cloud.maptiler.com/account/keys/',
  VITE_CLAUDE_API_KEY: 'Get token at https://console.anthropic.com/ (Optional - can be set in UI)',
}

const DOCS_SEARCH_ID = 'virtual:noodles-docs-search'
const RESOLVED_DOCS_SEARCH_ID = `\0${DOCS_SEARCH_ID}`
const DOC_CHUNK_CHARS = 1200
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
  'this',
  'that',
])

function docsSearchPlugin() {
  return {
    name: 'noodles-docs-search',
    resolveId(id) {
      return id === DOCS_SEARCH_ID ? RESOLVED_DOCS_SEARCH_ID : null
    },
    load(id) {
      if (id !== RESOLVED_DOCS_SEARCH_ID) return null
      return `export default ${JSON.stringify(buildDocsSearchIndex(process.cwd()))}`
    },
  }
}

function buildDocsSearchIndex(root) {
  const sources = [
    ...markdownFiles(path.resolve(root, '../docs')).map(file => ({ file, kind: 'docs' })),
    ...markdownFiles(path.resolve(root, 'src/ai-chat')).map(file => ({ file, kind: 'ai' })),
    ...markdownFiles(path.resolve(root, 'src/examples'))
      .filter(file => path.basename(file) === 'README.md')
      .map(file => ({ file, kind: 'example' })),
  ]
  const chunks = []
  for (const source of sources) {
    if (
      source.file.endsWith('/prompts/core.md') ||
      source.file.endsWith('/ai-chat/agents/README.md')
    )
      continue
    const content = fs.readFileSync(source.file, 'utf8')
    const topicId = docsTopicId(root, source.file, source.kind)
    const title = content.match(/^#\s+(.+)$/m)?.[1] ?? 'Untitled'
    let sectionCursor = 0
    for (const section of content.split(/(?=^#{1,6}\s+)/m)) {
      const sectionStart = content.indexOf(section, sectionCursor)
      sectionCursor = sectionStart + section.length
      const heading = section.match(/^#{1,6}\s+(.+)$/m)?.[1]
      const anchor = heading
        ?.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
      for (let start = 0; start < section.length; start += DOC_CHUNK_CHARS) {
        const raw = section.slice(start, start + DOC_CHUNK_CHARS)
        const leadingWhitespace = raw.length - raw.trimStart().length
        const text = raw.trim()
        if (!text) continue
        const tokens = docsTokens(
          `${title} ${title} ${title} ${heading ?? ''} ${heading ?? ''} ${text}`
        )
        const terms = new Map()
        for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1)
        const absoluteStart = sectionStart + start + leadingWhitespace
        chunks.push({
          topicId,
          heading,
          anchor,
          start: absoluteStart,
          end: absoluteStart + text.length,
          terms: [...terms],
          length: tokens.length,
        })
      }
    }
  }
  const frequencies = new Map()
  for (const chunk of chunks) {
    for (const [term] of chunk.terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
  }
  return {
    chunks,
    documentFrequency: [...frequencies],
    averageLength:
      chunks.reduce((sum, chunk) => sum + chunk.length, 0) / Math.max(1, chunks.length),
  }
}

function docsTopicId(root, file, kind) {
  if (kind === 'docs') {
    return path
      .relative(path.resolve(root, '../docs'), file)
      .replace(/\.md$/, '')
      .split(path.sep)
      .join('-')
  }
  if (kind === 'example') return `example-${path.basename(path.dirname(file))}`
  const relative = path.relative(path.resolve(root, 'src/ai-chat'), file).split(path.sep).join('/')
  if (relative.startsWith('prompts/sections/')) {
    return `workflow-${path.basename(relative, '.md')}`
  }
  return `ai-chat-${relative.replace(/\.md$/, '').replace(/\//g, '-')}`
}

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : []
  })
}

function docsTokens(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 1 && !DOC_STOP_WORDS.has(term))
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  // Log helpful messages for missing optional environment variables in development
  if (mode === 'development') {
    Object.entries(ENV_VARIABLES_WITH_INSTRUCTIONS).forEach(([key, instruction]) => {
      if (!env[key]) {
        console.log(`ℹ️  ${key} not set. ${instruction}`)
      }
    })
  }

  return {
    base: mode === 'development' ? '/' : '/app/',
    server: {
      open: true,
    },
    // duckdb-wasm bundles WASM + worker files that break Vite's dep optimization.
    // web-llm is excluded for the opposite reason: it is only ever reached through
    // a dynamic import, and pre-bundling it would pull tens of megabytes into the
    // dev server's dep cache for every user who never picks a local model.
    optimizeDeps: {
      exclude: ['@duckdb/duckdb-wasm', '@mlc-ai/web-llm'],
    },
    // Workers ship as ES modules rather than Vite's default IIFE. The WebLLM
    // worker's dependency graph code-splits, which an IIFE build cannot express,
    // and every worker this app creates is already declared `type: 'module'`.
    worker: {
      format: 'es',
    },
    plugins: [
      docsSearchPlugin(),
      react(),
      nodePolyfills({
        protocolImports: true,
      }),
      {
        name: 'dev-asset-404',
        enforce: 'pre', // run before vite's history fallback
        configureServer(server) {
          const publicDir = server.config.publicDir
          const root = server.config.root

          server.middlewares.use((req, res, next) => {
            let url = req.url || '/'
            url = decodeURIComponent(url.split('?')[0])

            // let Vite handle its own virtual/internal paths and hoisted node_modules
            if (url.startsWith('/@') || url.startsWith('/node_modules/')) {
              next()
              return
            }

            // if it looks like a file request (has an extension)...
            if (/\.[a-zA-Z0-9]{1,8}$/.test(url)) {
              const safe = path.posix.normalize(url).replace(/^(\.\.[/\\])+/, '')

              const candidates = [
                publicDir && path.join(publicDir, safe),
                path.join(root, safe),
              ].filter(Boolean)

              const exists = candidates.some(p => fs.existsSync(p))
              if (!exists) {
                res.statusCode = 404
                res.end('Not found')
                return
              }
            }

            next()
          })
        },
      },
    ],
  }
})
