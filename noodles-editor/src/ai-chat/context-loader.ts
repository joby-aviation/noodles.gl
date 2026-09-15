// ContextLoader - Loads Claude AI context using runtime loaders

import { debugAiChat } from '../utils/debug'
import { getCodeIndex } from './runtime-code-index'
import { getDocsIndex } from './runtime-docs-loader'
import { getExamplesIndex } from './runtime-examples-loader'
import { getOperatorRegistry } from './runtime-operator-registry'
import type {
  CodeIndex,
  DocsIndex,
  ExamplesIndex,
  LoadProgress,
  OperatorRegistry,
} from './types'

export class ContextLoader {
  private codeIndex: CodeIndex | null = null
  private operatorRegistry: OperatorRegistry | null = null
  private docsIndex: DocsIndex | null = null
  private examples: ExamplesIndex | null = null

  // Load all context using runtime loaders with progress tracking
  async load(onProgress?: (progress: LoadProgress) => void): Promise<void> {
    debugAiChat('Loading context using runtime loaders...')

    try {
      // Phase 1: Load code index
      onProgress?.({
        stage: 'code',
        loaded: 1,
        total: 5,
        bytesLoaded: 0,
        bytesTotal: 0,
      })

      this.codeIndex = getCodeIndex()
      debugAiChat('Code index loaded')

      // Phase 2: Load operator registry
      onProgress?.({
        stage: 'operators',
        loaded: 2,
        total: 5,
        bytesLoaded: 0,
        bytesTotal: 0,
      })

      this.operatorRegistry = getOperatorRegistry()
      debugAiChat('Operator registry loaded')

      // Phase 3: Load docs index
      onProgress?.({
        stage: 'docs',
        loaded: 3,
        total: 5,
        bytesLoaded: 0,
        bytesTotal: 0,
      })

      this.docsIndex = getDocsIndex()
      debugAiChat('Docs index loaded')

      // Phase 4: Load examples (lightweight - full projects loaded on-demand)
      onProgress?.({
        stage: 'examples',
        loaded: 4,
        total: 5,
        bytesLoaded: 0,
        bytesTotal: 0,
      })

      this.examples = getExamplesIndex()
      debugAiChat('Examples index loaded')

      // Complete
      onProgress?.({
        stage: 'complete',
        loaded: 5,
        total: 5,
        bytesLoaded: 0,
        bytesTotal: 0,
      })

      debugAiChat('All context loaded successfully')
    } catch (error) {
      debugAiChat('Failed to load context:', error)
      throw error
    }
  }

  // Getters for loaded data
  getCodeIndex(): CodeIndex | null {
    return this.codeIndex
  }

  getOperatorRegistry(): OperatorRegistry | null {
    return this.operatorRegistry
  }

  getDocsIndex(): DocsIndex | null {
    return this.docsIndex
  }

  getExamples(): ExamplesIndex | null {
    return this.examples
  }
}
