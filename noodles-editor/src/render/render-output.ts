const RENDER_EXTENSION_RE = /\.(?:jpe?g|png|mp4)$/i
const INVALID_FILENAME_CHARS_RE = /[\\/:*?"<>|]+/g

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

export async function getVersionedRenderFileName(
  directoryHandle: FileSystemDirectoryHandle,
  requestedBaseName: string,
  extension: string,
  fallback = 'render'
): Promise<string> {
  const { baseName, version } = await getNextRenderVersion(
    directoryHandle,
    requestedBaseName,
    fallback
  )
  const normalizedExtension = extension.replace(/^\./, '')
  return `${baseName}-v${version}.${normalizedExtension}`
}
