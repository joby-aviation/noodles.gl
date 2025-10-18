// ContextLoader - Loads and caches Claude AI context bundles

import type {
  Manifest,
  CodeIndex,
  OperatorRegistry,
  DocsIndex,
  ExamplesIndex,
  LoadProgress
} from './types'

export class ContextLoader {
  private baseUrl = '/app/context'
  private manifest: Manifest | null = null
  private codeIndex: CodeIndex | null = null
  private operatorRegistry: OperatorRegistry | null = null
  private docsIndex: DocsIndex | null = null
  private examples: ExamplesIndex | null = null

  // Load all context bundles with progress tracking
  async load(onProgress?: (progress: LoadProgress) => void): Promise<void> {
    // 1. Load manifest
    onProgress?.({
      stage: 'manifest',
      loaded: 0,
      total: 5,
      bytesLoaded: 0,
      bytesTotal: 0
    })

    try {
      this.manifest = await this.fetchJSON<Manifest>(`${this.baseUrl}/manifest.json`)
    } catch (error) {
      console.warn('Context bundles not available. Advanced features (code search, operator schemas) will be disabled.')
      console.warn('To enable these features, run: yarn generate:context')
      // Continue without context - basic chat will still work
      onProgress?.({
        stage: 'complete',
        loaded: 5,
        total: 5,
        bytesLoaded: 0,
        bytesTotal: 0
      })
      return
    }

    // 2. Load bundles (check cache first)
    const bundles = this.manifest.bundles
    const totalBytes = Object.values(bundles).reduce((sum, b) => sum + b.size, 0)
    let bytesLoaded = 0

    // Load code index
    onProgress?.({
      stage: 'code',
      loaded: 1,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    })

    this.codeIndex = await this.fetchCachedBundle<CodeIndex>(
      bundles.codeIndex.file,
      bundles.codeIndex.hash
    )
    bytesLoaded += bundles.codeIndex.size

    // Load operator registry
    onProgress?.({
      stage: 'operators',
      loaded: 2,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    })

    this.operatorRegistry = await this.fetchCachedBundle<OperatorRegistry>(
      bundles.operatorRegistry.file,
      bundles.operatorRegistry.hash
    )
    bytesLoaded += bundles.operatorRegistry.size

    // Load docs index
    onProgress?.({
      stage: 'docs',
      loaded: 3,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    })

    this.docsIndex = await this.fetchCachedBundle<DocsIndex>(
      bundles.docsIndex.file,
      bundles.docsIndex.hash
    )
    bytesLoaded += bundles.docsIndex.size

    // Load examples
    onProgress?.({
      stage: 'examples',
      loaded: 4,
      total: 5,
      bytesLoaded,
      bytesTotal: totalBytes
    })

    this.examples = await this.fetchCachedBundle<ExamplesIndex>(
      bundles.examples.file,
      bundles.examples.hash
    )
    bytesLoaded += bundles.examples.size

    onProgress?.({
      stage: 'complete',
      loaded: 5,
      total: 5,
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes
    })
  }

  // Fetch bundle with browser cache support (IndexedDB)
  private async fetchCachedBundle<T>(filename: string, hash: string): Promise<T> {
    // Try IndexedDB cache first
    const cached = await this.getCachedBundle<T>(hash)
    if (cached) {
      console.log(`Loaded ${filename} from cache`)
      return cached
    }

    // Fetch from network
    console.log(`Fetching ${filename} from network...`)
    const data = await this.fetchJSON<T>(`${this.baseUrl}/${filename}`)

    // Store in IndexedDB
    await this.setCachedBundle(hash, data)

    return data
  }

  private async fetchJSON<T>(url: string): Promise<T> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
    }
    return response.json()
  }

  private async getCachedBundle<T>(hash: string): Promise<T | null> {
    try {
      const db = await this.openDB()
      const tx = db.transaction('bundles', 'readonly')
      const store = tx.objectStore('bundles')

      return new Promise((resolve, reject) => {
        const request = store.get(hash)
        request.onsuccess = () => {
          const result = request.result
          resolve(result?.data || null)
        }
        request.onerror = () => reject(request.error)
      })
    } catch (err) {
      console.warn('IndexedDB cache miss:', err)
      return null
    }
  }

  private async setCachedBundle<T>(hash: string, data: T): Promise<void> {
    try {
      const db = await this.openDB()
      const tx = db.transaction('bundles', 'readwrite')
      const store = tx.objectStore('bundles')

      return new Promise((resolve, reject) => {
        const request = store.put({ hash, data, timestamp: Date.now() })
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (err) {
      console.warn('Failed to cache bundle:', err)
    }
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('noodles-context', 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('bundles')) {
          db.createObjectStore('bundles', { keyPath: 'hash' })
        }
      }
    })
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
