import { readAssetBinary } from '../storage'
import { projectScheme, type StorageType } from './filesystem'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

type DeckLayerDescriptor = {
  type: string
  [key: string]: unknown
}

type ProjectAssetContext = {
  activeStorageType: StorageType
  currentProjectName: string | null
}

type CacheEntry = {
  contentIdentity: string
  sourceKey: string
  url: string
}

type PendingResolution = {
  createdUrls: Set<string>
  descriptorEntries: Array<{ descriptorIdentity: object; entry: CacheEntry }>
  nextCache: Map<string, CacheEntry>
}

export type DeckProjectAssetResolution<T extends DeckLayerDescriptor> = {
  generation: number
  layers: T[]
}

function extensionOf(fileName: string) {
  const match = /(?:^|\/)(?:[^/]*)(\.[^./]+)$/.exec(fileName)
  return match?.[1]?.toLowerCase() ?? ''
}

function descriptorIdentity(layer: DeckLayerDescriptor) {
  // ListField's Zod parse shallow-clones layer descriptors whenever any sibling layer changes,
  // but it preserves nested values. Layer operators create a new updateTriggers object on each
  // execution, making it a stable execution identity across unrelated list/renderer updates.
  return layer.updateTriggers !== null && typeof layer.updateTriggers === 'object'
    ? layer.updateTriggers
    : layer
}

async function contentIdentity(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Owns browser resources needed while materializing serializable layer descriptors.
 * Operators deliberately keep emitting project-relative references; this runtime service
 * resolves them only at the boundary where Deck.gl layer instances are constructed.
 */
export class DeckProjectAssetResolver {
  private activeCache = new Map<string, CacheEntry>()
  private descriptorCache = new WeakMap<object, CacheEntry>()
  private disposed = false
  private generation = 0
  private pendingResolutions = new Map<number, PendingResolution>()
  private retiredUrls = new Map<string, number>()

  private isCurrent(generation: number) {
    return !this.disposed && generation === this.generation
  }

  private revokePendingResolutions() {
    for (const pending of this.pendingResolutions.values()) {
      for (const url of pending.createdUrls) URL.revokeObjectURL(url)
    }
    this.pendingResolutions.clear()
  }

  private beginResolution() {
    this.generation++
    this.revokePendingResolutions()
    return this.generation
  }

  async resolveLayers<T extends DeckLayerDescriptor>(
    layers: readonly T[],
    context: ProjectAssetContext
  ): Promise<DeckProjectAssetResolution<T> | null> {
    if (this.disposed) return null

    const generation = this.beginResolution()
    const projectImages = new Map<
      string,
      {
        fileName: string
        layers: Array<{ descriptor: T; descriptorIdentity: object; index: number }>
        sourceKey: string
      }
    >()

    for (const [index, layer] of layers.entries()) {
      if (
        layer.type !== 'BitmapLayer' ||
        typeof layer.image !== 'string' ||
        !layer.image.startsWith(projectScheme)
      ) {
        continue
      }

      if (!context.currentProjectName) {
        throw new Error('No project loaded. Please save or load a project first.')
      }

      const fileName = layer.image.substring(projectScheme.length)
      const sourceKey = JSON.stringify([
        context.activeStorageType,
        context.currentProjectName,
        fileName,
      ])
      const request = projectImages.get(sourceKey)
      const identity = descriptorIdentity(layer)
      if (request) request.layers.push({ descriptor: layer, descriptorIdentity: identity, index })
      else {
        projectImages.set(sourceKey, {
          fileName,
          layers: [{ descriptor: layer, descriptorIdentity: identity, index }],
          sourceKey,
        })
      }
    }

    const loadedImages = await Promise.all(
      Array.from(projectImages.values(), async request => {
        const activeEntry = this.activeCache.get(request.sourceKey)
        const descriptorsAreCached =
          activeEntry !== undefined &&
          request.layers.every(
            ({ descriptorIdentity }) =>
              this.descriptorCache.get(descriptorIdentity)?.url === activeEntry.url
          )
        if (descriptorsAreCached) return { ...request, cachedEntry: activeEntry }

        // FileUrlField can overwrite an asset without changing its @/ path, so the current
        // bytes—not the path alone—must participate in cache identity whenever an operator
        // emits a new descriptor. Stable descriptors from unrelated vis updates reuse the URL.
        const result = await readAssetBinary(
          context.activeStorageType,
          context.currentProjectName as string,
          request.fileName
        )
        if (!this.isCurrent(generation)) return null
        if (!result.success) throw new Error(result.error.message)

        const identity = await contentIdentity(result.data)
        if (!this.isCurrent(generation)) return null
        return { ...request, data: result.data, identity }
      })
    )

    if (!this.isCurrent(generation) || loadedImages.some(image => image === null)) return null

    const resolvedLayers = [...layers]
    const nextCache = new Map<string, CacheEntry>()
    const createdUrls = new Set<string>()
    const descriptorEntries: PendingResolution['descriptorEntries'] = []

    try {
      for (const loadedImage of loadedImages) {
        if (!loadedImage) continue

        const cached =
          'cachedEntry' in loadedImage
            ? loadedImage.cachedEntry
            : this.activeCache.get(loadedImage.sourceKey)
        let entry = cached
        if (
          !entry ||
          ('identity' in loadedImage && entry.contentIdentity !== loadedImage.identity)
        ) {
          if (!('data' in loadedImage) || !('identity' in loadedImage)) continue
          const mimeType =
            IMAGE_MIME_TYPES[extensionOf(loadedImage.fileName)] ?? 'application/octet-stream'
          const url = URL.createObjectURL(new Blob([loadedImage.data], { type: mimeType }))
          createdUrls.add(url)
          entry = {
            sourceKey: loadedImage.sourceKey,
            contentIdentity: loadedImage.identity,
            url,
          }
        }
        nextCache.set(entry.sourceKey, entry)

        for (const { descriptorIdentity, index } of loadedImage.layers) {
          descriptorEntries.push({ descriptorIdentity, entry })
          resolvedLayers[index] = {
            ...resolvedLayers[index],
            image: entry.url,
          }
        }
      }
    } catch (error) {
      for (const url of createdUrls) URL.revokeObjectURL(url)
      throw error
    }

    if (!this.isCurrent(generation)) {
      for (const url of createdUrls) URL.revokeObjectURL(url)
      return null
    }

    this.pendingResolutions.set(generation, { createdUrls, descriptorEntries, nextCache })
    return { generation, layers: resolvedLayers }
  }

  /** Commits a resolution immediately before its layer instances are published to React. */
  commit<T extends DeckLayerDescriptor>(resolution: DeckProjectAssetResolution<T>) {
    const pending = this.pendingResolutions.get(resolution.generation)
    if (!pending || !this.isCurrent(resolution.generation)) {
      this.discard(resolution)
      return false
    }

    const nextUrls = new Set(Array.from(pending.nextCache.values(), entry => entry.url))
    for (const entry of this.activeCache.values()) {
      if (!nextUrls.has(entry.url)) this.retiredUrls.set(entry.url, resolution.generation)
    }

    this.activeCache = pending.nextCache
    for (const { descriptorIdentity, entry } of pending.descriptorEntries) {
      this.descriptorCache.set(descriptorIdentity, entry)
    }
    this.pendingResolutions.delete(resolution.generation)
    return true
  }

  discard<T extends DeckLayerDescriptor>(resolution: DeckProjectAssetResolution<T>) {
    const pending = this.pendingResolutions.get(resolution.generation)
    if (!pending) return
    for (const url of pending.createdUrls) URL.revokeObjectURL(url)
    this.pendingResolutions.delete(resolution.generation)
  }

  /** Revoke superseded URLs only after React has committed the replacement layer props. */
  releaseRetiredUrlsThrough(generation: number) {
    for (const [url, retiredAt] of this.retiredUrls) {
      if (retiredAt > generation) continue
      URL.revokeObjectURL(url)
      this.retiredUrls.delete(url)
    }
  }

  cancelPending() {
    if (this.disposed) return
    this.generation++
    this.revokePendingResolutions()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.revokePendingResolutions()

    const urls = new Set([
      ...Array.from(this.activeCache.values(), entry => entry.url),
      ...this.retiredUrls.keys(),
    ])
    for (const url of urls) URL.revokeObjectURL(url)
    this.activeCache.clear()
    this.descriptorCache = new WeakMap<object, CacheEntry>()
    this.retiredUrls.clear()
  }
}
