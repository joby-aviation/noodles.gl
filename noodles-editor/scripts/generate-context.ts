#!/usr/bin/env tsx
// Generate context bundles for Claude AI integration
//
// This script generates:
// - operator-registry.json: All operator schemas
// - docs-index.json: Searchable documentation
// - examples.json: Example projects with annotations
// - code-index.json: Simplified source code index
// - manifest.json: Bundle metadata

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

// Import categories directly from source
import { categories as baseCategories } from '../src/noodles/components/categories.ts'
// Import operator parser
import { parseOperatorsFile } from './parse-operators.ts'

const ROOT_DIR = path.join(process.cwd(), '..')
const SRC_DIR = path.join(process.cwd(), 'src')
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const EXAMPLES_DIR = path.join(process.cwd(), 'public', 'noodles')
const OUTPUT_DIR = path.join(process.cwd(), 'dist', 'context')

const packageJson = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8')
)
const version = packageJson.version

interface OperatorRegistry {
  version: string
  operators: Record<string, any>
  categories: Record<string, string[]>
}

interface DocsIndex {
  version: string
  topics: Record<string, any>
}

interface ExamplesIndex {
  version: string
  examples: Record<string, any>
}

interface CodeIndex {
  version: string
  files: Record<string, any>
}

interface Manifest {
  version: string
  generated: string
  commit: string
  bundles: Record<string, { file: string; size: number; hash: string }>
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 10)
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readFilesSafe(dir: string, extension: string, required: boolean = false): string[] {
  if (!fs.existsSync(dir)) {
    if (required) {
      throw new Error(`Required directory not found: ${dir}`)
    }
    console.warn(`Directory not found: ${dir}`)
    return []
  }

  const files: string[] = []

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(fullPath)
        }
      } else if (entry.name.endsWith(extension)) {
        files.push(fullPath)
      }
    }
  }

  walk(dir)
  return files
}

function generateOperatorRegistry(): OperatorRegistry {
  console.log('Generating operator registry...')

  const operatorsFile = path.join(SRC_DIR, 'noodles', 'operators.ts')

  // Fail loudly if required files are missing
  if (!fs.existsSync(operatorsFile)) {
    throw new Error(`Required file not found: ${operatorsFile}`)
  }

  console.log(`Found ${Object.keys(baseCategories).length} categories from categories.ts`)

  // Build reverse lookup: operator -> category
  const opToCategory: Record<string, string> = {}
  for (const [category, ops] of Object.entries(baseCategories)) {
    for (const op of ops) {
      opToCategory[op] = category
    }
  }

  // Convert categories to plain object for JSON serialization
  const categoriesObject: Record<string, string[]> = {}
  for (const [category, ops] of Object.entries(baseCategories)) {
    categoriesObject[category] = [...ops] // Convert readonly array to regular array
  }

  // Parse operators using TypeScript Compiler API
  const parsedOperators = parseOperatorsFile(operatorsFile)
  const operators: Record<string, any> = {}

  for (const [opName, meta] of parsedOperators) {
    const category = opToCategory[opName] || 'utility'

    operators[opName] = {
      name: opName,
      type: opName,
      category,
      description: meta.description,
      displayName: meta.displayName,
      inputs: meta.inputs.reduce<Record<string, unknown>>((acc, input) => {
        acc[input.name] = {
          type: input.fieldType,
          default: input.defaultValue,
          ...input.options,
        }
        return acc
      }, {}),
      outputs: meta.outputs.reduce<Record<string, unknown>>((acc, output) => {
        acc[output.name] = {
          type: output.fieldType,
        }
        return acc
      }, {}),
      sourceFile: 'src/noodles/operators.ts',
      examples: [],
      relatedOperators: []
    }
  }

  console.log(`Found ${Object.keys(operators).length} operators`)

  return {
    version,
    operators,
    categories: categoriesObject
  }
}

function generateDocsIndex(): DocsIndex {
  console.log('Generating docs index...')

  const docFiles = readFilesSafe(DOCS_DIR, '.md')
  const topics: Record<string, any> = {}

  for (const file of docFiles) {
    const content = fs.readFileSync(file, 'utf-8')
    const relativePath = path.relative(DOCS_DIR, file)
    const id = relativePath.replace(/\.md$/, '').replace(/\//g, '-')

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1] : path.basename(file, '.md')

    // Determine section
    const section = relativePath.startsWith('users/') ? 'users' :
      relativePath.startsWith('developers/') ? 'developers' : 'intro'

    topics[id] = {
      id,
      title,
      section,
      file: relativePath,
      content,
      headings: extractHeadings(content),
      codeExamples: [],
      relatedTopics: []
    }
  }

  console.log(`Indexed ${Object.keys(topics).length} documentation topics`)

  return {
    version: '1.0.0',
    topics
  }
}

function extractHeadings(content: string): Array<{ level: number; text: string; anchor: string }> {
  const headings: Array<{ level: number; text: string; anchor: string }> = []
  const lines = content.split('\n')

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2]
      const anchor = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
      headings.push({ level, text, anchor })
    }
  }

  return headings
}

function generateExamplesIndex(): ExamplesIndex {
  console.log('Generating examples index...')

  // Mark examples directory as required - fail if it doesn't exist
  const exampleFiles = readFilesSafe(EXAMPLES_DIR, '.json', true)
  const examples: Record<string, any> = {}

  for (const file of exampleFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8')
      const project = JSON.parse(content)
      const filename = path.basename(file, '.json')
      const id = filename

      // Infer metadata from project
      const nodeTypes = new Set(project.nodes?.map((n: any) => n.type) || [])
      const layerTypes = Array.from(nodeTypes).filter((t: any) => t.includes('Layer'))
      const dataSourceTypes = Array.from(nodeTypes).filter((t: any) =>
        t.includes('File') || t.includes('JSON') || t.includes('DuckDb')
      )

      examples[id] = {
        id,
        name: filename.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: `Example project: ${filename}`,
        category: 'geospatial',
        project,
        annotations: {},
        tags: [filename.replace('-example', '')],
        dataSourceTypes,
        layerTypes,
        techniques: []
      }
    } catch (err) {
      console.warn(`Failed to parse example: ${file}`, err)
    }
  }

  console.log(`Indexed ${Object.keys(examples).length} examples`)

  return {
    version: '1.0.0',
    examples
  }
}

function generateCodeIndex(): CodeIndex {
  console.log('Generating code index...')

  // Mark SRC_DIR as required - fail if it doesn't exist
  const sourceFiles = readFilesSafe(SRC_DIR, '.ts', true).concat(readFilesSafe(SRC_DIR, '.tsx', true))
  const files: Record<string, any> = {}

  // Limit to key files to keep size manageable
  const keyFiles = sourceFiles.filter(f =>
    f.includes('noodles/operators.ts') ||
    f.includes('noodles/fields.ts') ||
    f.includes('noodles/noodles.tsx') ||
    f.includes('README.md')
  )

  // Verify critical files exist
  const operatorsFile = keyFiles.find(f => f.includes('noodles/operators.ts'))
  if (!operatorsFile) {
    throw new Error('Required file not found: noodles/operators.ts')
  }

  for (const file of keyFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8')
      const relativePath = path.relative(SRC_DIR, file)
      const lines = content.split('\n')

      files[relativePath] = {
        path: relativePath,
        fullText: content,
        lines,
        hash: hashContent(content),
        lastModified: fs.statSync(file).mtime.toISOString(),
        symbols: [],
        imports: [],
        exports: []
      }
    } catch (err) {
      console.warn(`Failed to index file: ${file}`, err)
    }
  }

  console.log(`Indexed ${Object.keys(files).length} source files`)

  return {
    version: '1.0.0',
    files
  }
}

function writeBundle(name: string, data: any): { file: string; size: number; hash: string } {
  const content = JSON.stringify(data, null, 2)
  const hash = hashContent(content)
  const filename = `${name}.${hash}.json`
  const filepath = path.join(OUTPUT_DIR, filename)

  fs.writeFileSync(filepath, content, 'utf-8')

  const size = Buffer.byteLength(content, 'utf-8')
  console.log(`Wrote ${filename} (${(size / 1024).toFixed(2)} KB)`)

  return { file: filename, size, hash }
}

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

async function main() {
  console.log('Starting context generation...\n')

  // Ensure output directory exists
  ensureDir(OUTPUT_DIR)

  // Generate all bundles
  const operatorRegistry = generateOperatorRegistry()
  const docsIndex = generateDocsIndex()
  const examplesIndex = generateExamplesIndex()
  const codeIndex = generateCodeIndex()

  console.log('\nWriting bundles...')

  // Write bundles with content-addressed filenames
  const bundles = {
    operatorRegistry: writeBundle('operator-registry', operatorRegistry),
    docsIndex: writeBundle('docs-index', docsIndex),
    examples: writeBundle('examples', examplesIndex),
    codeIndex: writeBundle('code-index', codeIndex)
  }

  // Generate manifest
  const manifest: Manifest = {
    version: '1.0.0',
    generated: new Date().toISOString(),
    commit: getGitCommit(),
    bundles
  }

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`\nWrote manifest.json`)

  console.log('\n✅ Context generation complete!')
  console.log(`Output directory: ${OUTPUT_DIR}`)
  console.log(`Total size: ${(Object.values(bundles).reduce((sum, b) => sum + b.size, 0) / 1024).toFixed(2)} KB`)
}

main().catch(err => {
  console.error('Error generating context:', err)
  process.exit(1)
})
