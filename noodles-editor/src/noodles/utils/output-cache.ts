import { debugSerialize } from '../../utils/debug'
import { directoryExists, readFileFromDirectory, writeFileToDirectory } from './filesystem'

// A locked operator's last outputs live in the project's cache folder, one file per operator,
// so a reload serves them without executing and noodles.json stays small.
export const CACHE_DIRECTORY_NAME = 'cache'
export const OUTPUT_CACHE_VERSION = 1

// Op id -> saved outputs, handed to transformGraph on load
export type OutputCache = Map<string, Record<string, unknown>>
// Cache file name -> file contents, written on save
export type OutputCacheFiles = Map<string, string>

type OutputCacheFile = {
  version: number
  id: string
  type: string
  outputs: Record<string, unknown>
}

type CacheNode = { id: string; type?: string; data?: unknown }

const FILE_EXTENSION = '.json'
// Most file systems cap a name at 255 bytes. Encoded names are ASCII, so length is bytes.
const MAX_FILE_NAME_LENGTH = 255
// Windows refuses these as the part of a file name before the first dot
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i

function escapeChar(char: string) {
  return Array.from(
    new TextEncoder().encode(char),
    byte => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  ).join('')
}

// '/container/drive-directions' -> 'container.drive-directions.json'. Letters, digits, '-' and
// '_' are kept and everything else, '.' included, is percent-encoded as UTF-8. That leaves '.'
// free to separate path segments and keeps the name legal on Windows, macOS and Linux.
export function opIdToCacheFileName(id: string): string {
  const segments = id
    .replace(/^\//, '')
    .split('/')
    .map(segment => segment.replace(/[^A-Za-z0-9_-]/gu, escapeChar))
  if (WINDOWS_RESERVED_NAME.test(segments[0])) {
    segments[0] = escapeChar(segments[0][0]) + segments[0].slice(1)
  }
  return `${segments.join('.')}${FILE_EXTENSION}`
}

export function cacheFileNameToOpId(fileName: string): string | null {
  if (!fileName.endsWith(FILE_EXTENSION)) return null
  try {
    const segments = fileName.slice(0, -FILE_EXTENSION.length).split('.')
    return `/${segments.map(decodeURIComponent).join('/')}`
  } catch {
    return null
  }
}

// True when JSON round-trips the value unchanged: only primitives, arrays and plain objects.
// Functions, class instances (layers, Dates, typed arrays) and cycles would be lost or altered,
// and so would undefined or an empty slot in an array, which come back as null. An undefined
// object property is dropped, which reads back the same, so routes without a toll price pass.
function isJsonSafe(value: unknown, ancestors = new Set<unknown>()): boolean {
  if (value === null) return true
  const type = typeof value
  if (type === 'string' || type === 'boolean') return true
  if (type === 'number') return Number.isFinite(value)
  if (type !== 'object' || ancestors.has(value)) return false
  const isArray = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (!isArray && proto !== Object.prototype && proto !== null) return false
  ancestors.add(value)
  const safe = isArray
    ? Array.from(value.keys()).every(i => i in value && isJsonSafe(value[i], ancestors))
    : Object.values(value as object).every(
        item => item === undefined || isJsonSafe(item, ancestors)
      )
  ancestors.delete(value)
  return safe
}



async function hasContents(directory: FileSystemDirectoryHandle, name: string, contents: string) {
  try {
    const file = await (await directory.getFileHandle(name)).getFile()
    return file.size === new Blob([contents]).size && (await file.text()) === contents
  } catch {
    return false
  }
}

// Brings the cache folder in line with `files`: writes new and changed files, then removes
// files no locked operator owns any more (unlocked, deleted or renamed). A cache failure never
// fails the save; the affected operators execute once on the next load. A file that can't be
// written is removed, so the next load doesn't serve the result it held before.
export async function writeOutputCache(
  projectDirectory: FileSystemDirectoryHandle,
  files: OutputCacheFiles
): Promise<void> {
  try {
    if (files.size === 0 && !(await directoryExists(projectDirectory, CACHE_DIRECTORY_NAME))) {
      return
    }
    const cacheDirectory = await projectDirectory.getDirectoryHandle(CACHE_DIRECTORY_NAME, {
      create: true,
    })
    for (const [name, contents] of files) {
      if (await hasContents(cacheDirectory, name, contents)) continue
      try {
        await writeFileToDirectory(cacheDirectory, name, contents)
      } catch (error) {
        debugSerialize('Could not write cache file %s, removing it: %O', name, error)
        await cacheDirectory.removeEntry(name).catch(() => {})
      }
    }

    const entries: FileSystemHandle[] = []
    for await (const entry of cacheDirectory.values()) entries.push(entry)
    const listed = new Set(entries.map(entry => entry.name))
    // After a case-only rename, a case-insensitive file system (macOS, Windows) lists the file
    // just written under its old spelling. That file is still owned, so it must stay.
    const ownedSpelling = new Map(Array.from(files.keys(), name => [name.toLowerCase(), name]))
    const isOwned = (name: string) => {
      if (files.has(name)) return true
      const owner = ownedSpelling.get(name.toLowerCase())
      return owner !== undefined && !listed.has(owner)
    }
    const stale: string[] = []
    let others = 0
    for (const entry of entries) {
      if (isOwned(entry.name)) continue
      // Leave anything that isn't a cache file, like a .gitignore
      if (entry.kind === 'file' && entry.name.endsWith(FILE_EXTENSION)) stale.push(entry.name)
      else others++
    }
    for (const name of stale) {
      debugSerialize('Removing stale cache file %s (%s)', name, cacheFileNameToOpId(name))
      await cacheDirectory.removeEntry(name)
    }
    if (files.size === 0 && others === 0) {
      await projectDirectory.removeEntry(CACHE_DIRECTORY_NAME)
    }
  } catch (error) {
    debugSerialize('Could not update the output cache: %O', error)
  }
}

function parseOutputCacheFile(text: string, node: CacheNode): Record<string, unknown> | null {
  let file: Partial<OutputCacheFile> | null
  try {
    file = JSON.parse(text)
  } catch {
    debugSerialize('%s: cache file is not valid JSON, will execute', node.id)
    return null
  }
  const outputs = file?.outputs
  if (
    file?.version !== OUTPUT_CACHE_VERSION ||
    file.id !== node.id ||
    file.type !== node.type ||
    typeof outputs !== 'object' ||
    outputs === null ||
    Array.isArray(outputs)
  ) {
    debugSerialize('%s: cache file does not match the operator, will execute', node.id)
    return null
  }
  return outputs
}

// Reads the saved outputs of the locked nodes. A missing, corrupt or mismatched file is
// skipped and its operator executes once, as if it had never been cached.
export async function readOutputCache(
  readFile: (fileName: string) => Promise<string | null>,
  nodes: CacheNode[]
): Promise<OutputCache> {
  const cache: OutputCache = new Map()
  const lockedNodes = nodes.filter(node => (node.data as { locked?: boolean })?.locked === true)
  await Promise.all(
    lockedNodes.map(async node => {
      const fileName = opIdToCacheFileName(node.id)
      const text = await readFile(fileName).catch(() => null)
      if (typeof text !== 'string') {
        debugSerialize('%s: no cache file %s, will execute', node.id, fileName)
        return
      }
      const outputs = parseOutputCacheFile(text, node)
      if (outputs) cache.set(node.id, outputs)
    })
  )
  return cache
}

export function readDirectoryOutputCache(
  projectDirectory: FileSystemDirectoryHandle,
  nodes: CacheNode[]
): Promise<OutputCache> {
  return readOutputCache(
    fileName => readFileFromDirectory(projectDirectory, `${CACHE_DIRECTORY_NAME}/${fileName}`),
    nodes
  )
}
