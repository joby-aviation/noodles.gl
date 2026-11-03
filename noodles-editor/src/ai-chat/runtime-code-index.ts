// Runtime code index - loads key source files and builds a searchable index

import type { CodeIndex, FileIndex, Symbol as SymbolType } from './types'

// Eagerly load key source files at startup
const sourceFiles = import.meta.glob(
  ['../noodles/operators.ts', '../noodles/fields.ts', '../noodles/noodles.tsx'],
  {
    eager: true,
    query: '?raw',
    import: 'default',
  }
)

// Simple regex-based symbol extraction
function extractSymbols(content: string): SymbolType[] {
  const symbols: SymbolType[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Export class
    const classMatch = line.match(/export\s+class\s+(\w+)/)
    if (classMatch) {
      const name = classMatch[1]
      // Find end of class (simple heuristic - next export or end of file)
      let endLine = lineNum
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^export\s+(class|const|function|interface|type)/)) {
          endLine = j
          break
        }
      }
      if (endLine === lineNum) endLine = lines.length

      symbols.push({
        name,
        type: 'class',
        line: lineNum,
        endLine,
      })
    }

    // Export function
    const funcMatch = line.match(/export\s+(async\s+)?function\s+(\w+)/)
    if (funcMatch) {
      const name = funcMatch[2]
      symbols.push({
        name,
        type: 'function',
        line: lineNum,
        endLine: lineNum + 1,
      })
    }

    // Export const
    const constMatch = line.match(/export\s+const\s+(\w+)/)
    if (constMatch) {
      const name = constMatch[1]
      symbols.push({
        name,
        type: 'const',
        line: lineNum,
        endLine: lineNum + 1,
      })
    }

    // Export type/interface
    const typeMatch = line.match(/export\s+(type|interface)\s+(\w+)/)
    if (typeMatch) {
      const name = typeMatch[2]
      symbols.push({
        name,
        type: typeMatch[1] as 'type' | 'interface',
        line: lineNum,
        endLine: lineNum + 1,
      })
    }
  }

  return symbols
}

// Extract imports (simple regex approach)
function extractImports(content: string) {
  const imports: Array<{ module: string; imports: string[]; line: number }> = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const importMatch = line.match(/import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/)
    if (importMatch) {
      const namedImports = importMatch[1] ? importMatch[1].split(',').map(s => s.trim()) : []
      const defaultImport = importMatch[2] ? [importMatch[2]] : []
      const module = importMatch[3]

      imports.push({
        module,
        imports: [...defaultImport, ...namedImports],
        line: i + 1,
      })
    }
  }

  return imports
}

// Extract exports (simple regex approach)
function extractExports(content: string) {
  const exports: Array<{ name: string; type: string; line: number }> = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const exportMatch = line.match(/export\s+(?:(class|function|const|type|interface)\s+)?(\w+)/)
    if (exportMatch) {
      exports.push({
        name: exportMatch[2],
        type: exportMatch[1] || 'unknown',
        line: i + 1,
      })
    }
  }

  return exports
}

// Hash content for change detection
function hashContent(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

// Build file index from content
function indexFile(modulePath: string, content: string): FileIndex {
  // Extract relative path from module path
  const pathMatch = modulePath.match(/\.\.(\/noodles\/.+)/)
  const relativePath = pathMatch ? pathMatch[1].slice(1) : modulePath

  const lines = content.split('\n')

  return {
    path: relativePath,
    fullText: content,
    lines,
    hash: hashContent(content),
    lastModified: new Date().toISOString(), // Not available at runtime
    symbols: extractSymbols(content),
    imports: extractImports(content),
    exports: extractExports(content),
  }
}

// Build code index (cached after first access)
let codeCache: CodeIndex | null = null

export function getCodeIndex(): CodeIndex {
  if (codeCache) {
    return codeCache
  }

  const files: Record<string, FileIndex> = {}

  for (const [modulePath, content] of Object.entries(sourceFiles)) {
    const fileIndex = indexFile(modulePath, content as string)
    files[fileIndex.path] = fileIndex
  }

  codeCache = {
    version: '1.0.0',
    files,
  }

  return codeCache
}
