import { afterEach, describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from './serialization'
import { generateDraftId, memoryProjectStore } from './memory-project-store'

const STUB_PROJECT: NoodlesProjectJSON = {
  version: 14,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
}

describe('MemoryProjectStore', () => {
  afterEach(() => {
    memoryProjectStore.deleteProject('test-1')
    memoryProjectStore.deleteProject('test-2')
  })

  describe('project JSON', () => {
    it('returns null for unknown project', () => {
      expect(memoryProjectStore.getProjectJson('nonexistent')).toBeNull()
    })

    it('stores and retrieves project JSON', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      const result = memoryProjectStore.getProjectJson('test-1')
      expect(result).toEqual(STUB_PROJECT)
    })

    it('overwrites existing project JSON', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      const updated = { ...STUB_PROJECT, version: 15 }
      memoryProjectStore.setProjectJson('test-1', updated)
      expect(memoryProjectStore.getProjectJson('test-1')?.version).toBe(15)
    })

    it('isolates projects by id', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      memoryProjectStore.setProjectJson('test-2', { ...STUB_PROJECT, version: 99 })
      expect(memoryProjectStore.getProjectJson('test-1')?.version).toBe(14)
      expect(memoryProjectStore.getProjectJson('test-2')?.version).toBe(99)
    })
  })

  describe('asset read/write', () => {
    it('reads back a text asset', async () => {
      memoryProjectStore.writeAsset('test-1', 'cities.csv', 'name,pop\nNYC,8000000')
      const text = await memoryProjectStore.readAsset('test-1', 'cities.csv')
      expect(text).toBe('name,pop\nNYC,8000000')
    })

    it('reads back a binary asset', async () => {
      const buf = new Uint8Array([1, 2, 3, 4]).buffer
      memoryProjectStore.writeAsset('test-1', 'image.png', new Blob([buf]))
      const result = await memoryProjectStore.readAssetBinary('test-1', 'image.png')
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3, 4]))
    })

    it('returns null for missing asset', async () => {
      expect(await memoryProjectStore.readAsset('test-1', 'nope.csv')).toBeNull()
      expect(await memoryProjectStore.readAssetBinary('test-1', 'nope.bin')).toBeNull()
    })

    it('strips data/ prefix on write and read', async () => {
      memoryProjectStore.writeAsset('test-1', 'data/trips.json', '{"trips":[]}')
      expect(await memoryProjectStore.readAsset('test-1', 'trips.json')).toBe('{"trips":[]}')
      expect(await memoryProjectStore.readAsset('test-1', 'data/trips.json')).toBe('{"trips":[]}')
    })

    it('overwrites existing asset', async () => {
      memoryProjectStore.writeAsset('test-1', 'file.csv', 'v1')
      memoryProjectStore.writeAsset('test-1', 'file.csv', 'v2')
      expect(await memoryProjectStore.readAsset('test-1', 'file.csv')).toBe('v2')
    })

    it('accepts Blob contents', async () => {
      const blob = new Blob(['blob content'], { type: 'text/plain' })
      memoryProjectStore.writeAsset('test-1', 'readme.txt', blob)
      expect(await memoryProjectStore.readAsset('test-1', 'readme.txt')).toBe('blob content')
    })
  })

  describe('checkAssetExists', () => {
    it('returns false for unknown project', () => {
      expect(memoryProjectStore.checkAssetExists('nonexistent', 'file.csv')).toBe(false)
    })

    it('returns false for missing file', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      expect(memoryProjectStore.checkAssetExists('test-1', 'missing.csv')).toBe(false)
    })

    it('returns true after writing', () => {
      memoryProjectStore.writeAsset('test-1', 'data.csv', 'a,b')
      expect(memoryProjectStore.checkAssetExists('test-1', 'data.csv')).toBe(true)
    })

    it('normalizes data/ prefix', () => {
      memoryProjectStore.writeAsset('test-1', 'file.csv', 'x')
      expect(memoryProjectStore.checkAssetExists('test-1', 'data/file.csv')).toBe(true)
    })
  })

  describe('listDataFiles', () => {
    it('returns empty for unknown project', () => {
      expect(memoryProjectStore.listDataFiles('nonexistent')).toEqual([])
    })

    it('lists all asset names', () => {
      memoryProjectStore.writeAsset('test-1', 'a.csv', 'a')
      memoryProjectStore.writeAsset('test-1', 'b.json', '{}')
      const files = memoryProjectStore.listDataFiles('test-1')
      expect(files).toContain('a.csv')
      expect(files).toContain('b.json')
      expect(files).toHaveLength(2)
    })
  })

  describe('hasDataDirectory', () => {
    it('returns false for unknown project', () => {
      expect(memoryProjectStore.hasDataDirectory('nonexistent')).toBe(false)
    })

    it('returns false for project with no assets', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      expect(memoryProjectStore.hasDataDirectory('test-1')).toBe(false)
    })

    it('returns true when assets exist', () => {
      memoryProjectStore.writeAsset('test-1', 'data.csv', 'x')
      expect(memoryProjectStore.hasDataDirectory('test-1')).toBe(true)
    })
  })

  describe('getAllAssets', () => {
    it('returns empty map for unknown project', () => {
      expect(memoryProjectStore.getAllAssets('nonexistent').size).toBe(0)
    })

    it('returns all Blob entries', () => {
      memoryProjectStore.writeAsset('test-1', 'a.csv', 'a')
      memoryProjectStore.writeAsset('test-1', 'b.csv', 'b')
      const assets = memoryProjectStore.getAllAssets('test-1')
      expect(assets.size).toBe(2)
      expect(assets.has('a.csv')).toBe(true)
      expect(assets.has('b.csv')).toBe(true)
    })
  })

  describe('lifecycle', () => {
    it('has() returns false for missing project', () => {
      expect(memoryProjectStore.has('nonexistent')).toBe(false)
    })

    it('has() returns true after setProjectJson', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      expect(memoryProjectStore.has('test-1')).toBe(true)
    })

    it('has() returns true after writeAsset (auto-creates project)', () => {
      memoryProjectStore.writeAsset('test-1', 'x.csv', 'x')
      expect(memoryProjectStore.has('test-1')).toBe(true)
    })

    it('deleteProject removes everything', () => {
      memoryProjectStore.setProjectJson('test-1', STUB_PROJECT)
      memoryProjectStore.writeAsset('test-1', 'data.csv', 'x')
      memoryProjectStore.deleteProject('test-1')
      expect(memoryProjectStore.has('test-1')).toBe(false)
      expect(memoryProjectStore.getProjectJson('test-1')).toBeNull()
      expect(memoryProjectStore.checkAssetExists('test-1', 'data.csv')).toBe(false)
    })

    it('getOrCreate creates a fresh entry', () => {
      const project = memoryProjectStore.getOrCreate('test-1')
      expect(project.projectJson).toBeNull()
      expect(project.assets.size).toBe(0)
      expect(project.createdAt).toBeGreaterThan(0)
    })
  })
})

describe('generateDraftId', () => {
  it('produces unique ids', () => {
    const a = generateDraftId()
    const b = generateDraftId()
    expect(a).not.toBe(b)
  })

  it('uses given prefix', () => {
    expect(generateDraftId('example')).toMatch(/^example-/)
    expect(generateDraftId('import')).toMatch(/^import-/)
    expect(generateDraftId()).toMatch(/^draft-/)
  })

  it('produces reasonable length', () => {
    const id = generateDraftId()
    expect(id.length).toBeLessThan(20)
    expect(id.length).toBeGreaterThan(5)
  })
})
