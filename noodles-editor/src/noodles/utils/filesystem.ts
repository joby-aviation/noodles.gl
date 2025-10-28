// Prefix for project data directory
export const projectScheme = '@/'

// Note: Design is extensible for future cloud storage support
export type FileSystemSupport = {
  fileSystemAccess: boolean
  opfs: boolean
}

export type StorageType = keyof FileSystemSupport | 'publicFolder'

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

export async function readFileFromDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<string> {
  const fileHandle = await directoryHandle.getFileHandle(fileName)
  const file = await fileHandle.getFile()
  return await file.text()
}

export async function writeFileToDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  contents: FileSystemWriteChunkType
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, {
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
    await directoryHandle.getFileHandle(fileName)
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
