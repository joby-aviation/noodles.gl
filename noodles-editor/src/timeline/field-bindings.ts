// Timeline track paths for a node's fields, in the format the timeline panel names its tracks.

// "/my-operator" -> "my-operator", "/container/nested" -> "container / nested"
export function opIdToObjectName(opId: string): string {
  return opId.slice(1).split('/').join(' / ')
}

// "objectName / fieldName / subField"
export function getFieldPath(opId: string, fieldName: string, subPath?: string[]): string {
  const objectName = opIdToObjectName(opId)
  const parts = [objectName, fieldName, ...(subPath || [])]
  return parts.join(' / ')
}
