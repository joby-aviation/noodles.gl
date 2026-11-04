import { debugRender } from '../utils/debug'

// File names for exports. Every export of a base name shares one -vN counter, whatever its
// format: after map-v1.png and map-v2.mp4 the next image sequence is map-v3_0000.png.

// Every extension an export writes: photos, videos, and image sequence frames
export const RENDER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'mp4', 'webm', 'exr'] as const
export type RenderExtension = (typeof RENDER_EXTENSIONS)[number]

const EXTENSION_PATTERN = RENDER_EXTENSIONS.join('|')
const TRAILING_EXTENSION_RE = new RegExp(`\\.(?:${EXTENSION_PATTERN})$`, 'i')
// Not allowed in file names on Windows or macOS, or path separators
const INVALID_CHARACTERS_RE = /[\\/:*?"<>|]+/g
// File systems cap names at 255 bytes; this leaves room for -vN, a frame number and the extension
const MAX_BASE_NAME_BYTES = 200
// Windows can't create files named after devices, with or without an extension
const RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i

const encoder = new TextEncoder()

// Cuts whole characters, so a multi-byte character is never split
function truncateToBytes(text: string, maxBytes: number): string {
  let bytes = 0
  let result = ''
  for (const character of text) {
    bytes += encoder.encode(character).length
    if (bytes > maxBytes) break
    result += character
  }
  return result
}

function clean(value: unknown): string {
  // An expression can produce a number; anything else is not a name
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string') return ''
  const name = truncateToBytes(
    Array.from(text)
      // Control characters
      .filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join('')
      .trim()
      .replace(TRAILING_EXTENSION_RE, '')
      .replace(INVALID_CHARACTERS_RE, '-'),
    MAX_BASE_NAME_BYTES
  )
    // Leading dots hide the file, and Windows drops trailing dots and spaces
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return RESERVED_NAME_RE.test(name) ? `${name}_` : name
}

// A base name that is safe to write, from a project name or a file name setting, which can
// be an expression's result. A render extension the user typed ("map.png") is dropped, since
// the export adds its own. Falls back to `fallback`, then to "render", when nothing is left.
export function sanitizeRenderBaseName(value: unknown, fallback = 'render'): string {
  return clean(value) || clean(fallback) || 'render'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Matches an export of `baseName` in any format, including image sequence frames
function versionPattern(baseName: string): RegExp {
  return new RegExp(`^${escapeRegExp(baseName)}-v(\\d+)(?:_\\d+)?\\.(?:${EXTENSION_PATTERN})$`, 'i')
}

// The version an export of `baseName` takes in the directory: one past the highest there,
// across photos, videos and image sequences, or 1 for a new name
export async function nextRenderVersion(
  directoryHandle: FileSystemDirectoryHandle,
  baseName: string
): Promise<number> {
  const pattern = versionPattern(baseName)
  let highest = 0
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'file') continue
    const match = name.match(pattern)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return highest + 1
}

// map-v3.mp4, or map-v3_0042.png for a frame of an image sequence
export function renderFileName({
  baseName,
  version,
  extension,
  frame,
}: {
  baseName: string
  version: number
  extension: RenderExtension
  frame?: string
}): string {
  return `${baseName}-v${version}${frame === undefined ? '' : `_${frame}`}.${extension}`
}

export type RenderFileReservation = {
  name: string
  version: number
  handle: FileSystemFileHandle
  // Deletes the reserved file, for an export that failed. Never throws.
  discard: () => Promise<void>
}

// Reservations in this tab run one at a time, so exports started together get their own versions
let reservationQueue: Promise<unknown> = Promise.resolve()

// Claims the next version by creating its first file (the video, the photo, or a sequence's
// first frame). Another export scanning the folder then sees it and takes the version after.
export function reserveRenderFile(
  directoryHandle: FileSystemDirectoryHandle,
  name: { baseName: string; extension: RenderExtension; frame?: string }
): Promise<RenderFileReservation> {
  const reservation = reservationQueue.then(async () => {
    const version = await nextRenderVersion(directoryHandle, name.baseName)
    const fileName = renderFileName({ ...name, version })
    const handle = await directoryHandle.getFileHandle(fileName, { create: true })
    const discard = async () => {
      try {
        await directoryHandle.removeEntry(fileName)
      } catch (error) {
        debugRender('Could not delete the reserved file %s: %o', fileName, error)
      }
    }
    return { name: fileName, version, handle, discard }
  })
  reservationQueue = reservation.catch(() => {})
  return reservation
}
