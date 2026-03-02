// Monaco Completion Provider for Expression/Accessor fields
// Provides autocomplete suggestions for data keys, globals, and operator paths

import type {
  ExpressionContext,
  GlobalDefinition,
  TargetFieldInfo,
} from '../utils/expression-context'

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
  sortText?: string
  insertTextRules?: number
}

// Field types that expect position/coordinate arrays
const POSITION_FIELD_TYPES = ['geopoint-3d', 'geopoint-2d', 'vec2', 'vec3']
// Field types that expect colors
const COLOR_FIELD_TYPES = ['color']
// Field types that expect scalar numbers
const SCALAR_FIELD_TYPES = ['number']

// Keys that commonly represent coordinates (case-insensitive matching)
const COORDINATE_KEY_PATTERNS = [
  'lng',
  'lat',
  'longitude',
  'latitude',
  'lon',
  'x',
  'y',
  'z',
  'alt',
  'altitude',
  'elevation',
  'start_lng',
  'start_lat',
  'end_lng',
  'end_lat',
  'source_lng',
  'source_lat',
  'target_lng',
  'target_lat',
]

// Keys that commonly represent numeric values
const SCALAR_KEY_PATTERNS = [
  'count',
  'value',
  'amount',
  'size',
  'weight',
  'radius',
  'population',
  'total',
  'sum',
  'avg',
  'average',
  'width',
  'height',
]

// Keys that commonly represent color values
const COLOR_KEY_PATTERNS = ['color', 'fill', 'stroke', 'rgb', 'rgba']

// Prioritize data keys based on target field type
function prioritizeDataKeys(
  dataKeys: string[],
  targetField?: TargetFieldInfo
): { prioritized: string[]; other: string[] } {
  if (!targetField) return { prioritized: [], other: dataKeys }

  let priorityPatterns: string[] = []

  if (POSITION_FIELD_TYPES.includes(targetField.fieldType)) {
    priorityPatterns = COORDINATE_KEY_PATTERNS
  } else if (COLOR_FIELD_TYPES.includes(targetField.fieldType)) {
    priorityPatterns = COLOR_KEY_PATTERNS
  } else if (SCALAR_FIELD_TYPES.includes(targetField.fieldType)) {
    priorityPatterns = SCALAR_KEY_PATTERNS
  }

  if (priorityPatterns.length === 0) return { prioritized: [], other: dataKeys }

  const prioritized = dataKeys.filter(key => {
    const baseKey = key.split('.').pop() || key
    return priorityPatterns.some(pattern => baseKey.toLowerCase().includes(pattern.toLowerCase()))
  })
  const other = dataKeys.filter(key => !prioritized.includes(key))

  return { prioritized, other }
}

// Create template completions based on target field type
function createTemplateCompletions(
  targetField: TargetFieldInfo | undefined,
  dataKeys: string[],
  range: CompletionRange,
  CompletionItemKind: MonacoInstance
): CompletionItem[] {
  if (!targetField) return []

  const templates: CompletionItem[] = []
  const { prioritized } = prioritizeDataKeys(dataKeys, targetField)

  if (POSITION_FIELD_TYPES.includes(targetField.fieldType)) {
    // Find lng/lat-like keys for position template
    const lngKey = prioritized.find(k =>
      ['lng', 'longitude', 'lon', 'x', 'start_lng', 'source_lng'].some(p =>
        k.toLowerCase().endsWith(p)
      )
    )
    const latKey = prioritized.find(k =>
      ['lat', 'latitude', 'y', 'start_lat', 'source_lat'].some(p => k.toLowerCase().endsWith(p))
    )

    // Suggest a concrete template if we found coordinate keys
    if (lngKey && latKey) {
      templates.push({
        label: `[d.${lngKey}, d.${latKey}]`,
        kind: CompletionItemKind.Snippet,
        detail: 'Position array [lng, lat]',
        insertText: `[d.${lngKey}, d.${latKey}]`,
        range,
        sortText: '!0000', // Sort to top
      })
    }

    // Generic position snippet
    templates.push({
      label: '[lng, lat]',
      kind: CompletionItemKind.Snippet,
      detail: 'Position array template',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Monaco snippet placeholder syntax
      insertText: '[d.${1:lng}, d.${2:lat}]',
      insertTextRules: 4, // InsertAsSnippet
      range,
      sortText: '!0001',
    })
  }

  if (COLOR_FIELD_TYPES.includes(targetField.fieldType)) {
    // Color array template
    templates.push({
      label: '[r, g, b, a]',
      kind: CompletionItemKind.Snippet,
      detail: 'RGBA color array',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Monaco snippet placeholder syntax
      insertText: '[${1:255}, ${2:255}, ${3:255}, ${4:255}]',
      insertTextRules: 4,
      range,
      sortText: '!0000',
    })
  }

  if (SCALAR_FIELD_TYPES.includes(targetField.fieldType) && prioritized.length > 0) {
    // Scalar expression template
    templates.push({
      label: `d.${prioritized[0]} * 10`,
      kind: CompletionItemKind.Snippet,
      detail: 'Scaled value expression',
      insertText: `d.${prioritized[0]} * \${1:10}`,
      insertTextRules: 4,
      range,
      sortText: '!0000',
    })
  }

  return templates
}

// Detect unclosed brackets in the expression
function detectUnclosedBrackets(text: string): { needsClosing: boolean; count: number } {
  const open = (text.match(/\[/g) || []).length
  const close = (text.match(/\]/g) || []).length
  return { needsClosing: open > close, count: open - close }
}

// Create bracket completion suggestions
function createBracketCompletions(
  textUntilPosition: string,
  range: CompletionRange,
  CompletionItemKind: MonacoInstance,
  targetField?: TargetFieldInfo
): CompletionItem[] {
  const { needsClosing, count } = detectUnclosedBrackets(textUntilPosition)

  if (!needsClosing) return []

  const suggestions: CompletionItem[] = []

  // Check if we're in what looks like a position array: [d.lng, d.lat
  const positionArrayPattern = /\[d\.\w+\s*,\s*d\.\w+\s*$/
  if (
    positionArrayPattern.test(textUntilPosition) &&
    targetField &&
    POSITION_FIELD_TYPES.includes(targetField.fieldType)
  ) {
    suggestions.push({
      label: ']',
      kind: CompletionItemKind.Text,
      detail: 'Close position array',
      insertText: ']',
      range,
      sortText: '!0000', // Sort to very top
    })
  }

  // Generic bracket closing
  if (count > 0) {
    const closingBrackets = ']'.repeat(count)
    suggestions.push({
      label: closingBrackets,
      kind: CompletionItemKind.Text,
      detail: `Close ${count} bracket${count > 1 ? 's' : ''}`,
      insertText: closingBrackets,
      range,
      sortText: '!0001',
    })
  }

  return suggestions
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
      const { dataKeys, globals, operatorPaths, targetField } = context

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

      // First: check for unclosed brackets and suggest closing
      suggestions.push(
        ...createBracketCompletions(
          textUntilPosition,
          range,
          monaco.languages.CompletionItemKind,
          targetField
        )
      )

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

      // Check for d. - suggest data keys with prioritization
      const dDotMatch = textUntilPosition.match(/\bd\.(\w*)$/)
      if (dDotMatch) {
        const { prioritized, other } = prioritizeDataKeys(dataKeys, targetField)

        // Add prioritized keys first with sort order to appear at top
        for (let i = 0; i < prioritized.length; i++) {
          suggestions.push({
            label: prioritized[i],
            kind: monaco.languages.CompletionItemKind.Property,
            detail: 'Data property (suggested)',
            insertText: prioritized[i],
            range,
            sortText: `0${String(i).padStart(4, '0')}`, // Sort to top
          })
        }

        // Add other keys with lower priority
        for (const key of other) {
          suggestions.push({
            label: key,
            kind: monaco.languages.CompletionItemKind.Property,
            detail: 'Data property',
            insertText: key,
            range,
            sortText: `1${key}`, // Sort after prioritized
          })
        }

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

      // Default: add template completions at the top based on target field type
      suggestions.push(
        ...createTemplateCompletions(
          targetField,
          dataKeys,
          range,
          monaco.languages.CompletionItemKind
        )
      )

      // Add all globals
      suggestions.push(
        ...createGlobalCompletions(globals, range, monaco.languages.CompletionItemKind)
      )

      // Also suggest data keys at top level for quick access (prioritized first)
      if (dataKeys.length > 0) {
        const { prioritized, other } = prioritizeDataKeys(dataKeys, targetField)
        const keysToShow = [...prioritized, ...other].slice(0, 10) // Limit to prevent overwhelming

        for (const key of keysToShow) {
          suggestions.push({
            label: `d.${key}`,
            kind: monaco.languages.CompletionItemKind.Property,
            detail: prioritized.includes(key)
              ? 'Data property (suggested)'
              : 'Data property shortcut',
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
