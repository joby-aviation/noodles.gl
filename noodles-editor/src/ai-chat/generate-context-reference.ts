// Generate compact context reference for system prompt

import { getCodeIndex } from './runtime-code-index'
import { getDocsIndex } from './runtime-docs-loader'
import { listExamples } from './runtime-examples-loader'
import { getOperatorRegistry } from './runtime-operator-registry'

// Generate a compact operator reference (categories + names only, no schemas)
function generateOperatorReference(): string {
  const registry = getOperatorRegistry()
  const lines = ['## Available Operators\n']

  // Sort categories alphabetically for consistency
  const sortedCategories = Object.entries(registry.categories).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  for (const [category, operators] of sortedCategories) {
    if (operators.length === 0) continue
    lines.push(`**${category}**: ${operators.join(', ')}`)
  }

  lines.push('\nUse `get_operator_schema({ type: "OperatorName" })` for full input/output schemas.')

  return lines.join('\n')
}

// Generate a compact docs index (IDs + titles only, no content)
function generateDocsReference(): string {
  const docsIndex = getDocsIndex()
  const lines = ['## Documentation Topics\n']

  // Group by section
  const sections: Record<string, Array<{ id: string; title: string }>> = {}
  for (const topic of Object.values(docsIndex.topics)) {
    if (!sections[topic.section]) {
      sections[topic.section] = []
    }
    sections[topic.section].push({ id: topic.id, title: topic.title })
  }

  // Sort sections
  const sectionOrder = ['intro', 'users', 'developers', 'ai-assistant', 'examples']
  for (const section of sectionOrder) {
    const topics = sections[section]
    if (!topics || topics.length === 0) continue

    lines.push(`\n**${section}**:`)
    // Show first 10 topics per section to keep it compact
    const topicsToShow = topics.slice(0, 10)
    for (const topic of topicsToShow) {
      lines.push(`- ${topic.title} (${topic.id})`)
    }
    if (topics.length > 10) {
      lines.push(`- ... and ${topics.length - 10} more`)
    }
  }

  lines.push(
    '\nUse `get_documentation({ id: "topic-id" })` for full content or `get_documentation({ query: "search terms" })` to search.'
  )

  return lines.join('\n')
}

// Generate a compact examples reference
function generateExamplesReference(): string {
  const examples = listExamples()
  const lines = ['## Available Examples\n']

  // Show first 10 examples
  const examplesToShow = examples.slice(0, 10)
  for (const example of examplesToShow) {
    lines.push(`- **${example.name}** (${example.id}): ${example.description}`)
  }

  if (examples.length > 10) {
    lines.push(`- ... and ${examples.length - 10} more`)
  }

  lines.push('\nUse `get_example({ id: "example-id" })` for full project details.')

  return lines.join('\n')
}

// Generate a compact code index reference
function generateCodeReference(): string {
  const codeIndex = getCodeIndex()
  const files = Object.keys(codeIndex.files)

  const lines = ['## Indexed Source Files\n']
  lines.push(files.map(f => `- ${f}`).join('\n'))
  lines.push(
    '\nUse `search_code({ pattern: "regex" })` to search or `get_source_code({ file: "path" })` to read.'
  )

  return lines.join('\n')
}

// Generate full compact reference to append to system prompt
export function generateContextReference(): string {
  const sections = [
    generateOperatorReference(),
    generateDocsReference(),
    generateExamplesReference(),
    generateCodeReference(),
  ]

  return [
    '\n---\n',
    '# Quick Reference (Compact Indexes)\n',
    'The full details are available via tools. These indexes show what exists so you can make intelligent tool calls.\n',
    ...sections,
  ].join('\n')
}
