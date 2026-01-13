// Monaco Completion Provider for Expression/Accessor fields
// Provides autocomplete suggestions for data keys, globals, and operator paths

import type { ExpressionContext, GlobalDefinition } from '../utils/expression-context'

// Monaco types - we get the actual monaco instance at runtime from @monaco-editor/react
// biome-ignore lint/suspicious/noExplicitAny: Monaco types come from runtime, not available at compile time
type MonacoInstance = any

interface CompletionRange {
  startLineNumber: number
  endLineNumber: number
  startColumn: number
  endColumn: number
}

interface CompletionItem {
  label: string
  kind: number
  detail: string
  insertText: string
  range: CompletionRange
}

// Create completion items for data keys (d.lat, d.lng, etc.)
function createDataKeyCompletions(
  dataKeys: string[],
  range: CompletionRange,
  CompletionItemKind: MonacoInstance
): CompletionItem[] {
  return dataKeys.map(key => ({
    label: key,
    kind: CompletionItemKind.Property,
    detail: 'Data property',
    insertText: key,
    range,
  }))
}

// Create completion items for global variables and libraries
function createGlobalCompletions(
  globals: GlobalDefinition[],
  range: CompletionRange,
  CompletionItemKind: MonacoInstance
): CompletionItem[] {
  return globals.map(global => ({
    label: global.name,
    kind:
      global.type === 'function'
        ? CompletionItemKind.Function
        : global.type === 'library'
          ? CompletionItemKind.Module
          : CompletionItemKind.Variable,
    detail: global.description,
    insertText: global.name,
    range,
  }))
}

// Create completion items for library properties (utils.getArc, d3.scaleLinear, etc.)
function createLibraryPropertyCompletions(
  properties: string[],
  range: CompletionRange,
  CompletionItemKind: MonacoInstance
): CompletionItem[] {
  return properties.map(prop => ({
    label: prop,
    kind: CompletionItemKind.Method,
    detail: 'Library function',
    insertText: prop,
    range,
  }))
}

// Create completion items for operator paths (for op() function)
function createOperatorPathCompletions(
  paths: string[],
  range: CompletionRange,
  CompletionItemKind: MonacoInstance
): CompletionItem[] {
  return paths.map(path => ({
    label: path,
    kind: CompletionItemKind.Reference,
    detail: 'Operator',
    insertText: path,
    range,
  }))
}

// Array method completions for data variable
const ARRAY_METHODS = [
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'findIndex',
  'some',
  'every',
  'includes',
  'indexOf',
  'slice',
  'concat',
  'flat',
  'flatMap',
  'sort',
  'reverse',
  'length',
]

// Create Monaco completion provider for expression fields
export function createExpressionCompletionProvider(
  monaco: MonacoInstance,
  getContext: () => ExpressionContext
): MonacoInstance {
  return {
    triggerCharacters: ['.', "'", '"', '('],

    provideCompletionItems(
      model: MonacoInstance,
      position: MonacoInstance
    ): { suggestions: CompletionItem[] } {
      const context = getContext()
      const { dataKeys, globals, operatorPaths } = context

      const word = model.getWordUntilPosition(position)
      const range: CompletionRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // Get the text before the cursor to determine context
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const suggestions: CompletionItem[] = []

      // Check for op(' or op(" or op(` - suggest operator paths
      const opPathMatch = textUntilPosition.match(/op\((['"`])([^'"`]*)$/)
      if (opPathMatch) {
        const partialPath = opPathMatch[2]
        const filteredPaths = operatorPaths.filter(p =>
          p.toLowerCase().startsWith(partialPath.toLowerCase())
        )
        suggestions.push(
          ...createOperatorPathCompletions(
            filteredPaths,
            range,
            monaco.languages.CompletionItemKind
          )
        )
        return { suggestions }
      }

      // Check for d. - suggest data keys
      const dDotMatch = textUntilPosition.match(/\bd\.(\w*)$/)
      if (dDotMatch) {
        suggestions.push(
          ...createDataKeyCompletions(dataKeys, range, monaco.languages.CompletionItemKind)
        )
        return { suggestions }
      }

      // Check for data. - suggest array methods
      const dataDotMatch = textUntilPosition.match(/\bdata\.(\w*)$/)
      if (dataDotMatch) {
        suggestions.push(
          ...createLibraryPropertyCompletions(
            ARRAY_METHODS,
            range,
            monaco.languages.CompletionItemKind
          )
        )
        return { suggestions }
      }

      // Check for data[0]. or data[N]. - suggest data keys
      const dataIndexMatch = textUntilPosition.match(/\bdata\[\d+\]\.(\w*)$/)
      if (dataIndexMatch) {
        suggestions.push(
          ...createDataKeyCompletions(dataKeys, range, monaco.languages.CompletionItemKind)
        )
        return { suggestions }
      }

      // Check for library. (utils., d3., turf., etc.)
      for (const global of globals) {
        if (global.type === 'library' && global.properties) {
          const libraryMatch = new RegExp(`\\b${global.name}\\.([\\w]*)$`).exec(textUntilPosition)
          if (libraryMatch) {
            suggestions.push(
              ...createLibraryPropertyCompletions(
                global.properties,
                range,
                monaco.languages.CompletionItemKind
              )
            )
            return { suggestions }
          }
        }
      }

      // Default: suggest all globals
      suggestions.push(
        ...createGlobalCompletions(globals, range, monaco.languages.CompletionItemKind)
      )

      // Also suggest data keys at top level for quick access
      if (dataKeys.length > 0) {
        // Add d.key suggestions as snippets
        for (const key of dataKeys.slice(0, 10)) {
          // Limit to prevent overwhelming
          suggestions.push({
            label: `d.${key}`,
            kind: monaco.languages.CompletionItemKind.Property,
            detail: 'Data property shortcut',
            insertText: `d.${key}`,
            range,
          })
        }
      }

      return { suggestions }
    },
  }
}

// Register the completion provider with Monaco
// Returns a disposable that can be used to unregister
export function registerExpressionCompletions(
  monaco: MonacoInstance,
  getContext: () => ExpressionContext
): { dispose: () => void } {
  const provider = createExpressionCompletionProvider(monaco, getContext)
  return monaco.languages.registerCompletionItemProvider('javascript', provider)
}
