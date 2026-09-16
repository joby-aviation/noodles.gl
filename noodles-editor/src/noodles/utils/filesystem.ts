// Prefix for project data directory
export const projectScheme = '@/'

// Note: Design is extensible for future cloud storage support
export type FileSystemSupport = {
  fileSystemAccess: boolean
  opfs: boolean
}

export type StorageType = keyof FileSystemSupport | 'publicFolder' | 'memory'

// ============================================================================
// OPFS (Origin Private File System) Functions
// ============================================================================

export async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return await navigator.storage.getDirectory()
}

// ============================================================================
// File System Access API Functions
// ============================================================================

// Check if native File System Access and sandboxed OPFS are supported.
export function checkFileSystemSupport(): FileSystemSupport {
  const fileSystemAccess =
    window?.isSecureContext === true &&
    'showDirectoryPicker' in window &&
    'showOpenFilePicker' in window &&
    'showSaveFilePicker' in window

  const opfs = 'storage' in navigator && 'getDirectory' in navigator.storage

  return { fileSystemAccess, opfs }
}

// Show directory picker and return selected directory handle
export async function selectDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!checkFileSystemSupport().fileSystemAccess) {
    throw new Error('File System Access API is not supported')
  }
  return await window.showDirectoryPicker({
    mode: 'readwrite',
  })
}

// Resolves a '/'-separated path to the handle of its containing directory plus the
// bare file name. getFileHandle rejects any name containing a separator, so without
// this a nested path is unaddressable — which is what listDataFiles returns for a
// project with subdirectories, and where the assistant's scratch files live.
async function resolveParent(
  directoryHandle: FileSystemDirectoryHandle,
  path: string,
  create: boolean
): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
  const segments = path.split('/').filter(segment => segment !== '')
  if (segments.length === 0) throw new TypeError(`Not a file path: '${path}'`)

  let directory = directoryHandle
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create })
  }
  return { directory, name: segments[segments.length - 1] }
}

export async function readFileFromDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<string> {
  const { directory, name } = await resolveParent(directoryHandle, fileName, false)
  const fileHandle = await directory.getFileHandle(name)
  const file = await fileHandle.getFile()
  return await file.text()
}

export async function readFileFromDirectoryBinary(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<ArrayBuffer> {
  const { directory, name } = await resolveParent(directoryHandle, fileName, false)
  const fileHandle = await directory.getFileHandle(name)
  const file = await fileHandle.getFile()
  return await file.arrayBuffer()
}

export async function writeFileToDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  contents: FileSystemWriteChunkType
): Promise<void> {
  // Intermediate directories are created on write, but never on read
  const { directory, name } = await resolveParent(directoryHandle, fileName, true)
  const fileHandle = await directory.getFileHandle(name, {
    create: true,
  })

  const writable = await fileHandle.createWritable()
  await writable.write(contents)
  await writable.close()
}

export async function fileExists(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<boolean> {
  try {
    const { directory, name } = await resolveParent(directoryHandle, fileName, false)
    await directory.getFileHandle(name)
    return true
  } catch (_error) {
    return false
  }
}

export async function directoryExists(
  directoryHandle: FileSystemDirectoryHandle,
  directoryName: string
): Promise<boolean> {
  try {
    await directoryHandle.getDirectoryHandle(directoryName)
    return true
  } catch (_error) {
    return false
  }
}

export async function requestPermission(
  directoryHandle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  try {
    const permission = await directoryHandle.queryPermission({ mode })
    if (permission === 'granted') return true

    const requestResult = await directoryHandle.requestPermission({ mode })
    return requestResult === 'granted'
  } catch (_error) {
    return false
  }
}
