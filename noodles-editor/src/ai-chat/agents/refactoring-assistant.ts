/**
 * Refactoring Assistant Agent
 *
 * Analyzes operator code and suggests improvements based on best practices.
 * Read-only analysis - does not automatically apply changes.
 */

import type { ContextLoader } from '../context-loader'

interface CodeSymbol {
  name: string
  kind: string
  line: number
  endLine?: number
}

interface CodeFile {
  lines: string[]
  symbols: CodeSymbol[]
}

interface CodeIndex {
  files: Record<string, CodeFile>
}

export interface CodeAnalysisResult {
  file: string
  issues: CodeIssue[]
  suggestions: Suggestion[]
  metrics?: CodeMetrics
}

export interface CodeIssue {
  type: 'purity' | 'types' | 'documentation' | 'performance' | 'duplication'
  severity: 'error' | 'warning' | 'info'
  line?: number
  message: string
  suggestion?: string
}

export interface Suggestion {
  type: 'refactor' | 'pattern' | 'optimization'
  description: string
  example?: string
}

export interface CodeMetrics {
  linesOfCode: number
  complexity: number
  dependencies: string[]
}

export class RefactoringAssistantAgent {
  constructor(private contextLoader: ContextLoader) {}

  /**
   * Analyze an operator for common issues and improvement opportunities
   */
  async analyzeOperator(params: { operatorType: string }): Promise<CodeAnalysisResult> {
    const { operatorType } = params
    const codeIndex = this.contextLoader.getCodeIndex()

    if (!codeIndex) {
      throw new Error('Code index not loaded')
    }

    // Find the operator class in the code
    const operatorFile = this.findOperatorFile(operatorType, codeIndex)
    if (!operatorFile) {
      throw new Error(`Operator not found: ${operatorType}`)
    }

    const { filePath, lines, startLine, endLine } = operatorFile

    // Perform various analyses
    const issues: CodeIssue[] = []
    const suggestions: Suggestion[] = []

    // Check for pure function violations
    this.checkPurity(lines, startLine, endLine, issues)

    // Check for type safety
    this.checkTypes(lines, startLine, endLine, issues)

    // Check for documentation
    this.checkDocumentation(lines, startLine, endLine, issues)

    // Check for performance issues
    this.checkPerformance(lines, startLine, endLine, issues, suggestions)

    // Generate suggestions based on best practices
    this.generateBestPracticeSuggestions(operatorType, lines, suggestions)

    return {
      file: filePath,
      issues,
      suggestions,
      metrics: this.calculateMetrics(lines),
    }
  }

  /**
   * Find duplicate code patterns across operators
   */
  async findDuplicates(params: { minLines?: number; category?: string }): Promise<{
    duplicates: Array<{
      pattern: string
      occurrences: Array<{ file: string; line: number }>
    }>
  }> {
    const minLines = params.minLines || 5
    const codeIndex = this.contextLoader.getCodeIndex()

    if (!codeIndex) {
      throw new Error('Code index not loaded')
    }

    const duplicates: Array<{
      pattern: string
      occurrences: Array<{ file: string; line: number }>
    }> = []

    // Simple duplicate detection: look for similar code blocks
    // In a real implementation, this would use AST-based comparison
    const codeBlocks = this.extractCodeBlocks(codeIndex, minLines)

    // Group similar blocks
    const similarBlocks = this.findSimilarBlocks(codeBlocks)

    for (const group of similarBlocks) {
      if (group.length > 1) {
        duplicates.push({
          pattern: group[0].code,
          occurrences: group.map(b => ({ file: b.file, line: b.line })),
        })
      }
    }

    return { duplicates }
  }

  /**
   * Suggest refactorings for an operator
   */
  async suggestRefactorings(params: { operatorType: string }): Promise<{
    refactorings: Array<{
      type: string
      description: string
      before: string
      after: string
    }>
  }> {
    const analysis = await this.analyzeOperator(params)
    const refactorings: Array<{
      type: string
      description: string
      before: string
      after: string
    }> = []

    // Convert suggestions to concrete refactorings
    for (const suggestion of analysis.suggestions) {
      if (suggestion.type === 'refactor' && suggestion.example) {
        refactorings.push({
          type: suggestion.type,
          description: suggestion.description,
          before: '', // Would extract from actual code
          after: suggestion.example,
        })
      }
    }

    return { refactorings }
  }

  // Private helper methods

  private findOperatorFile(
    operatorType: string,
    codeIndex: CodeIndex
  ): { filePath: string; lines: string[]; startLine: number; endLine: number } | null {
    // Search for class definition in code index
    for (const [filePath, file] of Object.entries(codeIndex.files)) {
      const symbol = file.symbols.find(s => s.name === operatorType && s.kind === 'class')
      if (symbol) {
        return {
          filePath,
          lines: file.lines,
          startLine: symbol.line,
          endLine: symbol.endLine || symbol.line + 50, // Default to 50 lines
        }
      }
    }
    return null
  }

  private checkPurity(
    lines: string[],
    startLine: number,
    endLine: number,
    issues: CodeIssue[]
  ): void {
    const executeMethodStart = this.findMethodStart(lines, 'execute', startLine, endLine)
    if (executeMethodStart === -1) return

    // Look for side effects in execute method
    const executeLines = lines.slice(executeMethodStart, endLine)
    const impurePatterns = [
      { pattern: /console\.(log|warn|error|info)/g, message: 'Avoid console logs in execute()' },
      { pattern: /window\./g, message: 'Avoid accessing global window in execute()' },
      { pattern: /document\./g, message: 'Avoid DOM manipulation in execute()' },
      { pattern: /Math\.random\(\)/g, message: 'Use deterministic alternatives to Math.random()' },
      {
        pattern: /Date\.now\(\)/g,
        message: 'Pass timestamps as inputs instead of using Date.now()',
      },
    ]

    for (const { pattern, message } of impurePatterns) {
      executeLines.forEach((line, idx) => {
        if (pattern.test(line)) {
          issues.push({
            type: 'purity',
            severity: 'warning',
            line: executeMethodStart + idx + 1,
            message,
          })
        }
      })
    }
  }

  private checkTypes(
    lines: string[],
    startLine: number,
    endLine: number,
    issues: CodeIssue[]
  ): void {
    const operatorLines = lines.slice(startLine, endLine)

    // Check for missing type annotations
    operatorLines.forEach((line, idx) => {
      // Check for untyped parameters
      if (line.includes('execute(') && !line.includes(':')) {
        issues.push({
          type: 'types',
          severity: 'warning',
          line: startLine + idx + 1,
          message: 'Execute method parameters should have type annotations',
        })
      }

      // Check for 'any' types
      if (line.includes(': any')) {
        issues.push({
          type: 'types',
          severity: 'info',
          line: startLine + idx + 1,
          message: 'Avoid using "any" type - use specific types instead',
        })
      }
    })
  }

  private checkDocumentation(
    lines: string[],
    startLine: number,
    endLine: number,
    issues: CodeIssue[]
  ): void {
    // Check for class documentation
    const _classLine = lines[startLine]
    const prevLine = startLine > 0 ? lines[startLine - 1] : ''

    if (!prevLine.includes('/**') && !prevLine.includes('//')) {
      issues.push({
        type: 'documentation',
        severity: 'info',
        line: startLine + 1,
        message: 'Add documentation comment for operator class',
        suggestion:
          'Add JSDoc comment describing what this operator does and its purpose in the pipeline',
      })
    }

    // Check for displayName and description
    const operatorLines = lines.slice(startLine, endLine).join('\n')
    if (!operatorLines.includes('displayName')) {
      issues.push({
        type: 'documentation',
        severity: 'warning',
        line: startLine + 1,
        message: 'Missing static displayName property',
      })
    }
    if (!operatorLines.includes('description')) {
      issues.push({
        type: 'documentation',
        severity: 'warning',
        line: startLine + 1,
        message: 'Missing static description property',
      })
    }
  }

  private checkPerformance(
    lines: string[],
    startLine: number,
    endLine: number,
    issues: CodeIssue[],
    suggestions: Suggestion[]
  ): void {
    const operatorLines = lines.slice(startLine, endLine)

    // Check for expensive operations in loops
    operatorLines.forEach((line, idx) => {
      if ((line.includes('forEach') || line.includes('map')) && line.includes('filter')) {
        issues.push({
          type: 'performance',
          severity: 'info',
          line: startLine + idx + 1,
          message: 'Consider combining filter and map operations',
          suggestion: 'Use reduce or a single loop to avoid multiple iterations',
        })
      }
    })

    // Suggest memoization if execute is complex
    if (operatorLines.length > 50) {
      suggestions.push({
        type: 'optimization',
        description:
          'Consider breaking down complex execute() into smaller helper methods for better testing and maintainability',
      })
    }
  }

  private generateBestPracticeSuggestions(
    operatorType: string,
    lines: string[],
    suggestions: Suggestion[]
  ): void {
    const code = lines.join('\n')

    // Check if using Zod schemas
    if (!code.includes('z.')) {
      suggestions.push({
        type: 'pattern',
        description: 'Use Zod schemas for field validation',
        example: `
// Example: Add Zod schema validation
import { z } from 'zod'

createInputs() {
  return {
    threshold: new NumberField(50, {
      schema: z.number().min(0).max(100),
    }),
  }
}`,
      })
    }

    // Check if layer operator has proper accessor patterns
    if (operatorType.includes('Layer') && !code.includes('getPosition')) {
      suggestions.push({
        type: 'pattern',
        description: 'Layer operators should define accessor functions',
        example: `
// Example: Define accessor inputs
createInputs() {
  return {
    data: new DataField(),
    getPosition: new AccessorField('[d.lng, d.lat]'),
    getFillColor: new AccessorField('[255, 0, 0]'),
  }
}`,
      })
    }

    // Suggest error handling
    if (!code.includes('try') && !code.includes('catch')) {
      suggestions.push({
        type: 'pattern',
        description: 'Add error handling for data processing operations',
        example: `
// Example: Handle errors gracefully
execute({ data }) {
  try {
    return { result: processData(data) }
  } catch (error) {
    console.error('Error processing data:', error)
    return { result: [] }
  }
}`,
      })
    }
  }

  private calculateMetrics(lines: string[]): CodeMetrics {
    // Simple metrics calculation
    const code = lines.join('\n')

    return {
      linesOfCode: lines.length,
      complexity: this.calculateComplexity(lines),
      dependencies: this.extractDependencies(code),
    }
  }

  private calculateComplexity(lines: string[]): number {
    // Simplified cyclomatic complexity
    let complexity = 1
    const complexityKeywords = ['if', 'else', 'for', 'while', 'case', '&&', '||', '?']

    for (const line of lines) {
      for (const keyword of complexityKeywords) {
        const pattern = new RegExp(`\\b${keyword}\\b`, 'g')
        const matches = line.match(pattern)
        if (matches) {
          complexity += matches.length
        }
      }
    }

    return complexity
  }

  private extractDependencies(code: string): string[] {
    const deps: string[] = []
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
    let match: RegExpExecArray | null = null

    match = importRegex.exec(code)
    while (match !== null) {
      deps.push(match[1])
      match = importRegex.exec(code)
    }

    return deps
  }

  private findMethodStart(
    lines: string[],
    methodName: string,
    startLine: number,
    endLine: number
  ): number {
    for (let i = startLine; i < endLine; i++) {
      if (lines[i].includes(`${methodName}(`)) {
        return i
      }
    }
    return -1
  }

  private extractCodeBlocks(
    codeIndex: CodeIndex,
    minLines: number
  ): Array<{ file: string; line: number; code: string }> {
    const blocks: Array<{ file: string; line: number; code: string }> = []

    for (const [filePath, file] of Object.entries(codeIndex.files)) {
      const lines = file.lines
      for (let i = 0; i < lines.length - minLines; i++) {
        const block = lines.slice(i, i + minLines).join('\n')
        if (block.trim().length > 0) {
          blocks.push({
            file: filePath,
            line: i + 1,
            code: block,
          })
        }
      }
    }

    return blocks
  }

  private findSimilarBlocks(
    blocks: Array<{ file: string; line: number; code: string }>
  ): Array<Array<{ file: string; line: number; code: string }>> {
    const groups: Map<string, Array<{ file: string; line: number; code: string }>> = new Map()

    for (const block of blocks) {
      // Normalize code for comparison (remove whitespace variations)
      const normalized = block.code.replace(/\s+/g, ' ').trim()

      if (!groups.has(normalized)) {
        groups.set(normalized, [])
      }
      groups.get(normalized)!.push(block)
    }

    // Return only groups with duplicates
    return Array.from(groups.values()).filter(group => group.length > 1)
  }
}
