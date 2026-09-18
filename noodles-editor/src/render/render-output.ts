const RENDER_EXTENSION_RE = /\.(?:jpe?g|png|mp4)$/i
const INVALID_FILENAME_CHARS_RE = /[\\/:*?"<>|]+/g
let allocationLock = Promise.resolve()

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter(character => character.charCodeAt(0) >= 32)
    .join('')
}

export function sanitizeRenderBaseName(value: string, fallback = 'render'): string {
  const sanitized = stripControlCharacters(value)
    .trim()
    .replace(RENDER_EXTENSION_RE, '')
    .replace(INVALID_FILENAME_CHARS_RE, '-')
    .replace(/[.\s]+$/g, '')

  if (sanitized) return sanitized

  const sanitizedFallback = stripControlCharacters(fallback)
    .trim()
    .replace(RENDER_EXTENSION_RE, '')
    .replace(INVALID_FILENAME_CHARS_RE, '-')
    .replace(/[.\s]+$/g, '')

  return sanitizedFallback || 'render'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function getNextRenderVersion(
  directoryHandle: FileSystemDirectoryHandle,
  requestedBaseName: string,
  fallback = 'render'
): Promise<{ baseName: string; version: number }> {
  const baseName = sanitizeRenderBaseName(requestedBaseName, fallback)
  const versionPattern = new RegExp(`^${escapeRegExp(baseName)}-v(\\d+)(?:[_.]|$)`, 'i')
  let highestVersion = 0

  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'file') continue
    const match = name.match(versionPattern)
    if (!match) continue

    highestVersion = Math.max(highestVersion, Number(match[1]))
  }

  return { baseName, version: highestVersion + 1 }
}

async function withAllocationLock<T>(allocate: () => Promise<T>): Promise<T> {
  const previous = allocationLock
  let release = () => {}
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  allocationLock = current

  await previous.catch(() => {})
  try {
    return await allocate()
  } finally {
    release()
    if (allocationLock === current) {
      allocationLock = Promise.resolve()
    }
  }
}

export async function reserveNextRenderVersion(
  directoryHandle: FileSystemDirectoryHandle,
  requestedBaseName: string,
  reservationSuffix: string,
  fallback = 'render'
): Promise<{ baseName: string; version: number }> {
  return withAllocationLock(async () => {
    const allocation = await getNextRenderVersion(directoryHandle, requestedBaseName, fallback)
    await directoryHandle.getFileHandle(
      `${allocation.baseName}-v${allocation.version}${reservationSuffix}`,
      { create: true }
    )
    return allocation
  })
}

export async function getVersionedRenderFileName(
  directoryHandle: FileSystemDirectoryHandle,
  requestedBaseName: string,
  extension: string,
  fallback = 'render'
): Promise<string> {
  const normalizedExtension = extension.replace(/^\./, '')
  const { baseName, version } = await reserveNextRenderVersion(
    directoryHandle,
    requestedBaseName,
    `.${normalizedExtension}`,
    fallback
  )
  return `${baseName}-v${version}.${normalizedExtension}`
}
