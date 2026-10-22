// The docs tools from the in-app assistant (src/ai-chat/tool-definitions.ts),
// same names and parameters, answered from a checkout instead of a running
// editor, plus validate_project.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type Registry,
  resolveOperatorType,
  unknownType,
  type ValidationResult,
  validateFile,
  validateProject,
} from 'noodles-validate'
import { z } from 'zod'
import { type DocTopic, loadDocs, type Section, searchDocs } from './docs.ts'
import { getExample, listExamples } from './examples.ts'

const SECTIONS = ['users', 'developers', 'ai-assistant', 'examples'] as const

// Read by the client when it connects. The last line is the stop condition: the
// T0 baseline's agents kept researching because nothing told them they were done.
export const INSTRUCTIONS = `Docs, operator schemas, examples and validation for Noodles.gl project files (noodles.json).

- Start from a similar project: list_examples, then get_example.
- Before writing an edge, read both operators with get_operator_schema. Edges go from out.<field> on the source to par.<field> on the target, using fields the schema lists or the node declares in data.customInputs. At a container's boundary the container's own par.<field> is a source and its out.<field> a target.
- After writing or editing a file, call validate_project with its path and fix every error.
- When validate_project returns "valid": true, the file is done. Stop researching.

To change a project open in a running editor, use its WebMCP tools instead.`

export interface Context {
  repoRoot: string
  // Relative paths given to validate_project resolve against this
  cwd: string
}

export function createServer({ repoRoot, cwd }: Context): McpServer {
  const registry = JSON.parse(
    readFileSync(join(repoRoot, 'noodles-validate/registry.json'), 'utf8')
  ) as Registry
  let docs: Record<string, DocTopic> | null = null
  const getDocs = () => {
    docs ??= loadDocs(repoRoot)
    return docs
  }

  const server = new McpServer(
    { name: 'noodles', version: '0.1.0' },
    { instructions: INSTRUCTIONS }
  )
  const readOnly = { readOnlyHint: true, openWorldHint: false }

  server.registerTool(
    'list_operators',
    {
      description: 'List all available operator types, optionally filtered by category',
      inputSchema: { category: z.string().optional().describe('Filter by operator category') },
      annotations: readOnly,
    },
    ({ category }) => {
      const operators = Object.values(registry.operators)
      const categories = [...new Set(operators.map(op => op.category ?? 'utility'))].sort()
      if (category && !categories.includes(category)) {
        return fail(`No category ${category}. Categories: ${categories.join(', ')}.`)
      }
      return ok(
        operators
          .filter(op => !category || op.category === category)
          .map(({ type, name, category, description }) => ({ type, name, category, description }))
      )
    }
  )

  server.registerTool(
    'get_operator_schema',
    {
      description:
        'Get the input/output field schema for an operator type (e.g. FileOp, ScatterplotLayerOp)',
      inputSchema: { type: z.string().describe('Operator type name') },
      annotations: readOnly,
    },
    ({ type }) => {
      const schema = registry.operators[resolveOperatorType(type, registry)]
      if (!schema) return fail(unknownType(type, registry))
      return ok({
        ...schema,
        handles: {
          inputs: Object.keys(schema.inputs).map(name => `par.${name}`),
          outputs: Object.keys(schema.outputs).map(name => `out.${name}`),
        },
      })
    }
  )

  server.registerTool(
    'get_documentation',
    {
      description:
        'Search the Noodles.gl documentation and step-by-step workflow guides. Searching returns excerpts with topic ids and noodles.gl URLs for linking; pass an id to read that topic in full.',
      inputSchema: {
        query: z.string().optional().describe('What you want to know about'),
        id: z
          .string()
          .optional()
          .describe('Id of a topic from a previous search, to read it in full'),
        section: z.enum(SECTIONS).optional().describe('Limit search to a docs section'),
      },
      annotations: readOnly,
    },
    ({ query, id, section }) => {
      const topics = getDocs()
      if (id) {
        const topic = topics[id]
        if (!topic) {
          return fail(`No documentation topic with id "${id}". Search by query to find valid ids.`)
        }
        return ok(topic)
      }
      const q = query?.trim()
      if (!q) return fail('get_documentation requires either a query or an id')
      const results = searchDocs(topics, q, section as Section | undefined)
      if (results.length === 0) {
        return ok({
          query: q,
          results: [],
          message: 'No documentation matched. Try fewer or more general terms.',
        })
      }
      return ok({
        query: q,
        results,
        hint: 'Call get_documentation with an id to read that topic in full.',
      })
    }
  )

  server.registerTool(
    'list_examples',
    {
      description: 'List all example projects, optionally filtered by category or tag',
      inputSchema: {
        category: z.string().optional().describe('Filter by category'),
        tag: z.string().optional().describe('Filter by tag'),
      },
      annotations: readOnly,
    },
    ({ category, tag }) =>
      ok(
        listExamples(repoRoot).filter(
          ex => (!category || ex.category === category) && (!tag || ex.tags.includes(tag))
        )
      )
  )

  server.registerTool(
    'get_example',
    {
      description:
        'Get an example project by ID, including its full node graph, README and the files beside it',
      inputSchema: { id: z.string().describe('Example project ID') },
      annotations: readOnly,
    },
    ({ id }) => {
      const example = getExample(repoRoot, id)
      if (!example) {
        const ids = listExamples(repoRoot).map(ex => ex.id)
        return fail(`Example not found: ${id}. Examples: ${ids.join(', ')}.`)
      }
      return ok(example)
    }
  )

  server.registerTool(
    'validate_project',
    {
      description:
        'Check a noodles.json project against the operator registry: schema version, operator types, input names, edge handles, duplicate edges. Every error says how to fix it. Call it after each edit; when valid is true, the file is done.',
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Path to the project file, absolute or relative to the working directory'),
        project: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .optional()
          .describe('The project itself, as an object or a JSON string, when there is no file'),
      },
      annotations: readOnly,
    },
    ({ path, project }) => {
      if ((path === undefined) === (project === undefined)) {
        return fail('validate_project takes either path or project, not both or neither.')
      }
      let result: ValidationResult
      if (path !== undefined) {
        const file = resolve(cwd, path)
        try {
          readFileSync(file)
        } catch {
          return fail(`No file at ${file}.`)
        }
        result = validateFile(file, registry)
      } else if (typeof project === 'string') {
        let parsed: unknown
        try {
          parsed = JSON.parse(project)
        } catch (error) {
          return fail(`project is not valid JSON: ${(error as Error).message}`)
        }
        result = validateProject(parsed, registry)
      } else {
        result = validateProject(project, registry)
      }
      return ok({ summary: summarize(result, registry), ...result, registry: about(registry) })
    }
  )

  return server
}

function summarize({ valid, errors, warnings }: ValidationResult, registry: Registry): string {
  const warned = warnings.length > 0 ? ` (${count(warnings.length, 'warning')})` : ''
  return valid
    ? `OK: valid against ${Object.keys(registry.operators).length} operators, schema version ${registry.projectVersion}${warned}. The file is done.`
    : `FAIL: ${count(errors.length, 'error')}${warned}. Fix them and validate again.`
}

function about(registry: Registry) {
  return {
    projectVersion: registry.projectVersion,
    operators: Object.keys(registry.operators).length,
  }
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Compact: results land in the model's context, where whitespace costs tokens
function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}
