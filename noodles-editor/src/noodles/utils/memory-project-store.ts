import type { NoodlesProjectJSON } from './serialization'

interface MemoryProject {
  projectJson: NoodlesProjectJSON | null
  assets: Map<string, Blob>
  createdAt: number
  displayName?: string
}

class MemoryProjectStore {
  private projects = new Map<string, MemoryProject>()

  getOrCreate(projectId: string): MemoryProject {
    let project = this.projects.get(projectId)
    if (!project) {
      project = { projectJson: null, assets: new Map(), createdAt: Date.now() }
      this.projects.set(projectId, project)
    }
    return project
  }

  getProjectJson(projectId: string): NoodlesProjectJSON | null {
    return this.projects.get(projectId)?.projectJson ?? null
  }

  setProjectJson(projectId: string, json: NoodlesProjectJSON): void {
    this.getOrCreate(projectId).projectJson = json
  }

  async readAsset(projectId: string, fileName: string): Promise<string | null> {
    const blob = this.getBlob(projectId, fileName)
    if (!blob) return null
    return await blob.text()
  }

  async readAssetBinary(projectId: string, fileName: string): Promise<ArrayBuffer | null> {
    const blob = this.getBlob(projectId, fileName)
    if (!blob) return null
    return await blob.arrayBuffer()
  }

  writeAsset(projectId: string, fileName: string, contents: string | Blob): void {
    const project = this.getOrCreate(projectId)
    const normalizedName = fileName.replace(/^data\//, '')
    const blob = typeof contents === 'string' ? new Blob([contents]) : contents
    project.assets.set(normalizedName, blob)
  }

  checkAssetExists(projectId: string, fileName: string): boolean {
    const normalizedName = fileName.replace(/^data\//, '')
    return this.projects.get(projectId)?.assets.has(normalizedName) ?? false
  }

  listDataFiles(projectId: string): string[] {
    const project = this.projects.get(projectId)
    if (!project) return []
    return Array.from(project.assets.keys())
  }

  hasDataDirectory(projectId: string): boolean {
    const project = this.projects.get(projectId)
    if (!project) return false
    return project.assets.size > 0
  }

  getAllAssets(projectId: string): Map<string, Blob> {
    return this.projects.get(projectId)?.assets ?? new Map()
  }

  deleteProject(projectId: string): void {
    this.projects.delete(projectId)
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId)
  }

  setDisplayName(projectId: string, displayName: string): void {
    this.getOrCreate(projectId).displayName = displayName
  }

  getDisplayName(projectId: string): string | null {
    return this.projects.get(projectId)?.displayName ?? null
  }

  private getBlob(projectId: string, fileName: string): Blob | undefined {
    const normalizedName = fileName.replace(/^data\//, '')
    return this.projects.get(projectId)?.assets.get(normalizedName)
  }
}

export const memoryProjectStore = new MemoryProjectStore()

export function generateDraftId(prefix = 'draft'): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}
