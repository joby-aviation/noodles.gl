// Runtime examples loader - lazy loads example projects on-demand

import { OPERATOR_INDEX } from '@noodles.gl/planner'
import hiddenExamples from '../examples/hidden.json'
import type { ExamplesIndex } from './types'

// Lazy load example projects - only loaded when requested
const exampleProjects = import.meta.glob<{ default: unknown }>('../examples/*/noodles.json')

// Eagerly load example READMEs
const exampleReadmes = import.meta.glob('../examples/*/README.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

// Extract example ID from module path
function getExampleId(modulePath: string): string {
  const match = modulePath.match(/\/examples\/([^/]+)\//)
  return match?.[1] || 'unknown'
}

// Strip large data fields from project to reduce size
function stripLargeDataFields(project: unknown): unknown {
  return JSON.parse(
    JSON.stringify(project, (_key, value) => {
      // Skip data fields that contain large datasets
      if (_key === 'data' && typeof value === 'object' && value !== null) {
        // Large arrays - keep first 10 items as sample
        if (Array.isArray(value) && value.length > 10) {
          return {
            _sample: value.slice(0, 10),
            _note: `Sample of first 10 items. Full dataset has ${value.length} items (truncated for size).`,
          }
        }
        // Large strings - keep first 1000 chars
        if (typeof value === 'string' && value.length > 1000) {
          return {
            _sample: value.substring(0, 1000),
            _note: `Sample of first 1000 characters. Full string has ${value.length} characters (truncated for size).`,
          }
        }
      }
      return value
    })
  )
}

// First sentence of the first paragraph, skipping headings and _italic_ attribution
// lines. It goes into the system prompt for every example, so keep it to one sentence
export function extractDescription(readme: string): string | undefined {
  for (const line of readme.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('_')) continue
    return trimmed.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? trimmed
  }
  return undefined
}

// Get metadata for all available examples (without loading full projects). Hidden
// examples are left in so getExample still finds them by id
function getExampleMetadata() {
  const metadata: Record<
    string,
    { id: string; name: string; description: string; readme: string; tags: string[] }
  > = {}

  // Get list of available examples from the project loaders
  const availableIds = new Set(Object.keys(exampleProjects).map(path => getExampleId(path)))

  // Build metadata from READMEs
  for (const [modulePath, content] of Object.entries(exampleReadmes)) {
    const id = getExampleId(modulePath)
    if (!availableIds.has(id)) continue

    const readme = content as string

    // Extract title from README
    const titleMatch = readme.match(/^#\s+(.+)$/m)
    const name = titleMatch
      ? titleMatch[1]
      : id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

    const description = extractDescription(readme) ?? `Example project: ${id}`

    metadata[id] = {
      id,
      name,
      description,
      readme,
      tags: id.split('-'),
    }
  }

  return metadata
}

// Load a specific example by ID
export async function getExample(id: string) {
  const projectPath = `../examples/${id}/noodles.json`
  const loader = exampleProjects[projectPath]

  if (!loader) {
    return null
  }

  // Load the project
  const module = await loader()
  const project = module.default

  // Get metadata
  const metadata = getExampleMetadata()
  const meta = metadata[id] || {
    id,
    name: id,
    description: `Example project: ${id}`,
    readme: '',
    tags: [],
  }

  // Infer additional metadata from the document: its operators by category
  const projectData = project as { nodes?: Array<{ op: string }> }
  const ops = [...new Set(projectData.nodes?.map(n => n.op) ?? [])]
  const category = (op: string) => OPERATOR_INDEX.get(op)?.category
  const layerTypes = ops.filter(op => category(op) === 'layer')
  const dataSourceTypes = ops.filter(op => category(op) === 'data')

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    category: 'geospatial',
    readme: meta.readme,
    project: stripLargeDataFields(project),
    annotations: {},
    tags: meta.tags,
    dataSourceTypes,
    layerTypes,
    techniques: [],
  }
}

// Examples not in hidden.json, the ones to offer when listing
function listed(metadata: ReturnType<typeof getExampleMetadata>) {
  return Object.values(metadata).filter(meta => !hiddenExamples.includes(meta.id))
}

// List all available examples
export function listExamples() {
  const metadata = getExampleMetadata()

  return listed(metadata).map(({ id, name, description, tags }) => ({
    id,
    name,
    description,
    tags,
  }))
}

// Build examples index (returns lightweight metadata without full projects)
let examplesCache: ExamplesIndex | null = null

export function getExamplesIndex(): ExamplesIndex {
  if (examplesCache) {
    return examplesCache
  }

  const metadata = getExampleMetadata()
  const examples: ExamplesIndex['examples'] = {}

  // Build lightweight index without loading full projects
  for (const meta of listed(metadata)) {
    examples[meta.id] = {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      category: 'geospatial',
      readme: meta.readme,
      project: {}, // Empty placeholder - use getExample() to load full project
      annotations: {},
      tags: meta.tags,
      dataSourceTypes: [],
      layerTypes: [],
      techniques: [],
    }
  }

  examplesCache = {
    version: '1.0.0',
    examples,
  }

  return examplesCache
}
