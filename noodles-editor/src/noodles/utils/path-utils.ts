// Path resolution utilities for fully qualified operator paths
// Supports Unix-style absolute and relative path resolution
import path from 'node:path'

const { basename, dirname, isAbsolute, join, normalize, resolve } = path.posix

export function isAbsolutePath(pathStr: string): boolean {
  if (!pathStr) return false
  return isAbsolute(pathStr)
}

export function getParentPath(operatorId: string): string | undefined {
  if (!operatorId) {
    return undefined
  }

  if (operatorId === '/') {
    return '/'
  }

  // Remove trailing slash if present
  const cleanPath = operatorId.endsWith('/') ? operatorId.slice(0, -1) : operatorId

  const parentDir = dirname(cleanPath)

  // dirname returns '.' for paths without directory separators
  if (parentDir === '.') {
    return undefined
  }

  return parentDir
}

export function getBaseName(operatorId: string): string {
  // Remove trailing slash if present
  const cleanPath = operatorId.endsWith('/') ? operatorId.slice(0, -1) : operatorId

  return basename(cleanPath)
}

// Normalize a path by removing redundant segments like '..' and '.'
export function normalizePath(pathStr: string): string {
  if (!pathStr) {
    return '/'
  }

  // Use normalize but ensure result is absolute
  let normalized = normalize(pathStr)

  // If the path doesn't start with '/', make it absolute
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }

  // Remove trailing slash except for root
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

// Resolve a path relative to a context operator
export function resolvePath(pathStr: string, contextOperatorId: string): string | undefined {
  if (!pathStr) {
    return undefined
  }

  // If path is absolute, just normalize and return
  if (isAbsolutePath(pathStr)) {
    return normalizePath(pathStr)
  }

  // Get the context container (parent of the context operator)
  const contextPath = getParentPath(contextOperatorId)
  if (contextPath === undefined) {
    return undefined
  }

  // Use path.resolve with the parent container as base
  const resolved = resolve(contextPath, pathStr)

  // Apply same normalization as other functions
  return normalizePath(resolved)
}

export function joinPath(...segments: string[]): string {
  const joined = join(...segments)
  return normalizePath(joined)
}

// Split a path into its segments, including the root segment
export function splitPath(pathStr: string | null): string[] {
  const segments = ['/']
  if (pathStr === null) {
    return segments
  }

  return segments.concat(pathStr.split('/').filter(segment => segment !== ''))
}

export function isValidPath(pathStr: string): boolean {
  if (!pathStr) {
    return false
  }

  // Must start with '/' for absolute paths
  if (!isAbsolutePath(pathStr)) {
    return false
  }

  // Check for invalid characters (basic check)
  if (pathStr.includes('//') || pathStr.includes('\0')) {
    return false
  }

  // Path segments cannot be empty (except root)
  if (pathStr !== '/' && pathStr.endsWith('/')) {
    return false
  }

  return true
}

// Generate a fully qualified path for an operator within a container
export function generateQualifiedPath(baseName: string, containerId: string): string {
  if (containerId === '/') {
    return `/${baseName}`
  }

  // Ensure container ID is properly formatted
  const containerPath = isAbsolutePath(containerId) ? containerId : `/${containerId}`
  return normalizePath(`${containerPath}/${baseName}`)
}

// Parse a handle ID into its components
// Handle format: namespace.fieldName (e.g., "par.data", "out.result")
export function parseHandleId(handleId: string):
  | {
      namespace: 'par' | 'out'
      fieldName: string
    }
  | undefined {
  if (!handleId) {
    return undefined
  }

  // Parse namespace.fieldName format
  if (handleId.startsWith('par.') || handleId.startsWith('out.')) {
    const [namespace, ...fieldParts] = handleId.split('.')
    const fieldName = fieldParts.join('.')

    if ((namespace === 'par' || namespace === 'out') && fieldName) {
      return {
        namespace,
        fieldName,
      }
    }
  }

  return undefined
}

// Check if an operator is a direct child of a container
export function isDirectChild(childOperatorId: string, containerOperatorId: string): boolean {
  if (!childOperatorId || !containerOperatorId) {
    return false
  }

  // Get the parent path of the child operator
  const childParentPath = getParentPath(childOperatorId)

  // Root level operators (like '/root-op') are not considered children of any container
  // even if the container is '/' (root)
  if (childParentPath === '/') {
    return false
  }

  // The child is a direct child if its parent path equals the container's path
  return childParentPath === containerOperatorId
}

// Get all direct child operators of a container from the opMap
export function getDirectChildren<T extends { id: string }>(
  containerOperatorId: string,
  opMap: Map<string, T>
): T[] {
  const children: T[] = []

  for (const op of opMap.values()) {
    if (isDirectChild(op.id, containerOperatorId)) {
      children.push(op)
    }
  }

  return children
}

// Check if an operator is anywhere within a container's hierarchy (direct or nested child)
export function isWithinContainer(operatorId: string, containerOperatorId: string): boolean {
  if (!operatorId || !containerOperatorId) {
    return false
  }

  // The operator is within the container if its path starts with the container's path followed by '/'
  return operatorId.startsWith(`${containerOperatorId}/`)
}
