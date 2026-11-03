import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessorOp, CodeOp, DirectionsOp, type GraphInputOp, ViewerOp } from '../operators'
import { clearOps, getOpStore, setOp } from '../store'
import { transformGraph } from '../transform-graph'
import {
  cacheFileNameToOpId,
  opIdToCacheFileName,
  readDirectoryOutputCache,
  readOutputCache,
  serializeOutputCache,
  writeOutputCache,
} from './output-cache'
import { safeStringify, serializeNodes } from './serialization'

const position = { x: 0, y: 0 }
const route = {
  distance: 29992,
  duration: 2301,
  durationFormatted: '38 mins, 21 secs',
  timestamps: [0, 2301],
  path: [
    [-81.31, 28.43],
    [-81.52, 28.37],
  ],
  hasTolls: true,
  tollAmount: 2.54,
  tollCurrency: 'USD',
}

function cacheFile(id: string, type = 'DirectionsOp', outputs: unknown = { route }) {
  return JSON.stringify({ version: 1, id, type, outputs })
}

async function lockedDirections(id: string) {
  const op = new DirectionsOp(id, { mode: 'driving-traffic' })
  vi.spyOn(op, 'execute').mockResolvedValue({ route })
  await op.pull()
  op.locked.next(true)
  setOp(id, op)
  return op
}

// A real directory in the browser's origin private file system, removed after each test
let root: FileSystemDirectoryHandle
let projectName: string
let project: FileSystemDirectoryHandle

beforeEach(async () => {
  root = await navigator.storage.getDirectory()
  projectName = `output-cache-test-${crypto.randomUUID()}`
  project = await root.getDirectoryHandle(projectName, { create: true })
})

afterEach(async () => {
  clearOps()
  vi.restoreAllMocks()
  await root.removeEntry(projectName, { recursive: true })
})

async function listCache() {
  try {
    const cache = await project.getDirectoryHandle('cache')
    const names: string[] = []
    for await (const entry of cache.values()) names.push(entry.name)
    return names.sort()
  } catch {
    return null
  }
}

async function readCache(name: string) {
  const cache = await project.getDirectoryHandle('cache')
  return (await (await cache.getFileHandle(name)).getFile()).text()
}

describe('opIdToCacheFileName', () => {
  it('names the file after the op id', () => {
    expect(opIdToCacheFileName('/directions')).toBe('directions.json')
    expect(opIdToCacheFileName('/drive_directions-2')).toBe('drive_directions-2.json')
  })

  it('joins container segments with dots', () => {
    expect(opIdToCacheFileName('/container/drive-directions')).toBe(
      'container.drive-directions.json'
    )
  })

  it('escapes dots so nested and dotted ids stay distinct', () => {
    expect(opIdToCacheFileName('/a.b')).toBe('a%2Eb.json')
    expect(opIdToCacheFileName('/a/b')).toBe('a.b.json')
  })

  it('escapes characters Windows or macOS refuse', () => {
    const name = opIdToCacheFileName('/my op<>:"\\|?*')
    expect(name).toBe('my%20op%3C%3E%3A%22%5C%7C%3F%2A.json')
    expect(name).toMatch(/^[A-Za-z0-9_%.-]+$/)
  })

  it('escapes names Windows reserves', () => {
    expect(opIdToCacheFileName('/con')).toBe('%63on.json')
    expect(opIdToCacheFileName('/LPT1/route')).toBe('%4CPT1.route.json')
    expect(opIdToCacheFileName('/console')).toBe('console.json')
  })

  it('encodes unicode as UTF-8', () => {
    expect(opIdToCacheFileName('/café')).toBe('caf%C3%A9.json')
  })

  it('round-trips through cacheFileNameToOpId', () => {
    const ids = [
      '/directions',
      '/container/drive-directions',
      '/a.b',
      '/my op<>:"\\|?*',
      '/con',
      '/café/über',
      '/100%',
    ]
    for (const id of ids) {
      expect(cacheFileNameToOpId(opIdToCacheFileName(id))).toBe(id)
    }
  })

  it('rejects names that are not cache files', () => {
    expect(cacheFileNameToOpId('.gitignore')).toBeNull()
    expect(cacheFileNameToOpId('broken%E0%A4.json')).toBeNull()
  })
})

describe('serializeOutputCache', () => {
  it('writes a file for a locked operator with output', async () => {
    await lockedDirections('/directions')
    const nodes = [{ id: '/directions', type: 'DirectionsOp' }]

    const files = serializeOutputCache(getOpStore(), nodes)

    expect([...files.keys()]).toEqual(['directions.json'])
    expect(JSON.parse(files.get('directions.json')!)).toEqual({
      version: 1,
      id: '/directions',
      type: 'DirectionsOp',
      outputs: { route },
    })
  })

  it('skips unlocked operators and locked operators without output', async () => {
    const unlocked = await lockedDirections('/unlocked')
    unlocked.locked.next(false)
    const neverRan = new DirectionsOp('/never-ran')
    neverRan.locked.next(true)
    setOp('/never-ran', neverRan)
    const nodes = [
      { id: '/unlocked', type: 'DirectionsOp' },
      { id: '/never-ran', type: 'DirectionsOp' },
    ]

    expect(serializeOutputCache(getOpStore(), nodes).size).toBe(0)
  })

  it('skips outputs that JSON cannot round-trip', async () => {
    const op = new AccessorOp('/accessor', { expression: 'd.x' })
    await op.pull()
    op.locked.next(true)
    setOp('/accessor', op)

    expect(serializeOutputCache(getOpStore(), [{ id: '/accessor', type: 'AccessorOp' }]).size).toBe(
      0
    )
  })

  it('skips arrays that JSON would change', async () => {
    const sparse = [1]
    sparse[2] = 3
    for (const data of [[1, undefined], sparse]) {
      const op = new CodeOp('/code')
      op.setOutputValues({ data })
      op.locked.next(true)
      setOp('/code', op)

      expect(serializeOutputCache(getOpStore(), [{ id: '/code', type: 'CodeOp' }]).size).toBe(0)
    }
  })

  it('writes a route without a toll price', async () => {
    const op = new DirectionsOp('/directions')
    const noToll = { ...route, hasTolls: false, tollAmount: undefined, tollCurrency: undefined }
    vi.spyOn(op, 'execute').mockResolvedValue({ route: noToll })
    await op.pull()
    op.locked.next(true)
    setOp('/directions', op)

    const files = serializeOutputCache(getOpStore(), [{ id: '/directions', type: 'DirectionsOp' }])

    expect(JSON.parse(files.get('directions.json')!).outputs.route).toEqual(noToll)
  })

  it('keeps outputs out of noodles.json', async () => {
    await lockedDirections('/directions')
    const node = { id: '/directions', type: 'DirectionsOp', data: {}, position }

    const [saved] = serializeNodes(getOpStore(), [node], [])

    expect(saved.data).toEqual({ inputs: { mode: 'driving-traffic' }, locked: true })
  })
})

describe('writeOutputCache', () => {
  it('writes one file per locked operator into cache/', async () => {
    const files = new Map([
      ['a.json', cacheFile('/a')],
      ['b.json', cacheFile('/b')],
    ])

    await writeOutputCache(project, files)

    expect(await listCache()).toEqual(['a.json', 'b.json'])
    expect(await readCache('a.json')).toBe(cacheFile('/a'))
  })

  it('leaves unchanged files alone', async () => {
    const files = new Map([['a.json', cacheFile('/a')]])
    await writeOutputCache(project, files)
    const cache = await project.getDirectoryHandle('cache')
    const before = (await (await cache.getFileHandle('a.json')).getFile()).lastModified
    // A rewrite would show a later time. The test setup fakes timers, so wait on a real one.
    vi.useRealTimers()
    await new Promise(resolve => setTimeout(resolve, 20))
    vi.useFakeTimers()

    await writeOutputCache(project, files)

    const after = (await (await cache.getFileHandle('a.json')).getFile()).lastModified
    expect(after).toBe(before)
  })

  it('rewrites changed files', async () => {
    await writeOutputCache(project, new Map([['a.json', cacheFile('/a')]]))
    const changed = cacheFile('/a', 'DirectionsOp', { route: { ...route, distance: 1 } })

    await writeOutputCache(project, new Map([['a.json', changed]]))

    expect(await readCache('a.json')).toBe(changed)
  })

  it('removes a file it cannot rewrite, so the next load does not serve the old result', async () => {
    await writeOutputCache(project, new Map([['a.json', cacheFile('/a')]]))
    vi.spyOn(FileSystemFileHandle.prototype, 'createWritable').mockRejectedValue(
      new DOMException('Disk full', 'QuotaExceededError')
    )
    const changed = cacheFile('/a', 'DirectionsOp', { route: { ...route, distance: 1 } })

    await writeOutputCache(project, new Map([['a.json', changed]]))

    expect(await listCache()).toEqual([])
  })

  it('removes the file of a renamed operator', async () => {
    await writeOutputCache(project, new Map([['old.json', cacheFile('/old')]]))

    await writeOutputCache(project, new Map([['new.json', cacheFile('/new')]]))

    expect(await listCache()).toEqual(['new.json'])
  })

  it('removes the files of unlocked or deleted operators', async () => {
    await writeOutputCache(
      project,
      new Map([
        ['a.json', cacheFile('/a')],
        ['b.json', cacheFile('/b')],
      ])
    )

    await writeOutputCache(project, new Map([['a.json', cacheFile('/a')]]))

    expect(await listCache()).toEqual(['a.json'])
  })

  it('removes the old spelling after a case-only rename', async () => {
    await writeOutputCache(project, new Map([['Route.json', cacheFile('/Route')]]))

    await writeOutputCache(project, new Map([['route.json', cacheFile('/route')]]))

    // OPFS is case-sensitive, so both spellings exist until the old one is removed
    expect(await listCache()).toEqual(['route.json'])
  })

  it('removes the empty cache folder once nothing is locked', async () => {
    await writeOutputCache(project, new Map([['a.json', cacheFile('/a')]]))

    await writeOutputCache(project, new Map())

    expect(await listCache()).toBeNull()
  })

  it('keeps files that are not cache files', async () => {
    await writeOutputCache(project, new Map([['a.json', cacheFile('/a')]]))
    const cache = await project.getDirectoryHandle('cache')
    await cache.getFileHandle('.gitignore', { create: true })

    await writeOutputCache(project, new Map())

    expect(await listCache()).toEqual(['.gitignore'])
  })

  it('creates no folder when there is nothing to cache', async () => {
    await writeOutputCache(project, new Map())

    expect(await listCache()).toBeNull()
  })
})

describe('readOutputCache', () => {
  const lockedNode = (id: string, type = 'DirectionsOp') => ({ id, type, data: { locked: true } })

  function reader(files: Record<string, string>) {
    return vi.fn(async (name: string) => files[name] ?? null)
  }

  it('reads the outputs of locked nodes', async () => {
    const cache = await readOutputCache(reader({ 'directions.json': cacheFile('/directions') }), [
      lockedNode('/directions'),
    ])

    expect(cache.get('/directions')).toEqual({ route })
  })

  it('does not read files for unlocked nodes', async () => {
    const readFile = reader({ 'directions.json': cacheFile('/directions') })

    const cache = await readOutputCache(readFile, [
      { id: '/directions', type: 'DirectionsOp', data: { locked: false } },
    ])

    expect(cache.size).toBe(0)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('skips missing, unreadable, corrupt and mismatched files', async () => {
    const readFile = vi.fn(async (name: string) => {
      if (name === 'unreadable.json') throw new Error('NotReadableError')
      const files: Record<string, string> = {
        'corrupt.json': '{"version":1,',
        'other-id.json': cacheFile('/someone-else'),
        'other-type.json': cacheFile('/other-type', 'NumberOp'),
        'other-version.json': JSON.stringify({
          version: 2,
          id: '/other-version',
          type: 'DirectionsOp',
          outputs: { route },
        }),
        'bad-outputs.json': cacheFile('/bad-outputs', 'DirectionsOp', [route]),
      }
      return files[name] ?? null
    })

    const cache = await readOutputCache(readFile, [
      lockedNode('/missing'),
      lockedNode('/unreadable'),
      lockedNode('/corrupt'),
      lockedNode('/other-id'),
      lockedNode('/other-type'),
      lockedNode('/other-version'),
      lockedNode('/bad-outputs'),
    ])

    expect(cache.size).toBe(0)
    expect(readFile).toHaveBeenCalledTimes(7)
  })
})

describe('locked operator save and reload through the cache folder', () => {
  // Save the way the editor does: noodles.json as JSON text, outputs into cache/
  async function save(id: string) {
    const node = { id, type: 'DirectionsOp', data: {}, position }
    const { nodes } = JSON.parse(safeStringify({ nodes: serializeNodes(getOpStore(), [node], []) }))
    await writeOutputCache(project, serializeOutputCache(getOpStore(), [node]))
    clearOps()
    return nodes as ReturnType<typeof serializeNodes>
  }

  async function reload(nodes: ReturnType<typeof serializeNodes>, id: string) {
    const outputCache = await readDirectoryOutputCache(project, nodes)
    transformGraph({ nodes, edges: [], outputCache })
    return getOpStore().getOp(id) as unknown as DirectionsOp
  }

  it('serves a locked route after reload without executing', async () => {
    await lockedDirections('/container/directions')
    const nodes = await save('/container/directions')
    expect(await listCache()).toEqual(['container.directions.json'])

    const reloaded = await reload(nodes, '/container/directions')
    const execute = vi.spyOn(reloaded, 'execute')

    expect(reloaded.locked.value).toBe(true)
    expect(reloaded.hasOutput).toBe(true)
    await expect(reloaded.pull()).resolves.toEqual({ route })
    expect(execute).not.toHaveBeenCalled()
  })

  it('feeds the restored route downstream without copying it into noodles.json', async () => {
    await lockedDirections('/directions')
    setOp('/viewer', new ViewerOp('/viewer'))
    const edge = {
      id: '/directions.out.route->/viewer.par.data',
      source: '/directions',
      target: '/viewer',
      sourceHandle: 'out.route',
      targetHandle: 'par.data',
    }
    const flowNodes = [
      { id: '/directions', type: 'DirectionsOp', data: {}, position },
      { id: '/viewer', type: 'ViewerOp', data: {}, position },
    ]
    const { nodes } = JSON.parse(
      safeStringify({ nodes: serializeNodes(getOpStore(), flowNodes, [edge]) })
    )
    await writeOutputCache(project, serializeOutputCache(getOpStore(), flowNodes))
    clearOps()

    expect(nodes[1].data.inputs).toEqual({})

    const outputCache = await readDirectoryOutputCache(project, nodes)
    transformGraph({ nodes, edges: [edge], outputCache })
    const directions = getOpStore().getOp('/directions') as unknown as DirectionsOp
    const viewer = getOpStore().getOp('/viewer') as unknown as ViewerOp
    const execute = vi.spyOn(directions, 'execute')

    expect(viewer.inputs.data.value).toEqual(route)
    await viewer.pull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes once when a saved date cannot be read', () => {
    const nodes = [{ id: '/date', type: 'DateTimeOp', data: { locked: true }, position }]
    const outputCache = new Map([['/date', { date: 'not a date' }]])

    expect(() => transformGraph({ nodes, edges: [], outputCache })).not.toThrow()
    expect(getOpStore().getOp('/date')?.hasOutput).toBe(false)
  })

  it('restores the custom outputs of a locked GraphInput', async () => {
    const nodes = [
      {
        id: '/box',
        type: 'ContainerOp',
        data: {
          inputs: {},
          customInputs: [
            { id: 'ci1', name: 'threshold', type: 'number', order: 0, defaultValue: 4 },
          ],
        },
        position,
      },
      { id: '/box/input', type: 'GraphInputOp', data: { locked: true }, position },
    ]
    const outputCache = new Map([['/box/input', { value: [1, 2], threshold: 9 }]])

    transformGraph({ nodes, edges: [], outputCache })
    const input = getOpStore().getOp('/box/input') as unknown as GraphInputOp
    const execute = vi.spyOn(input, 'execute')

    // Custom outputs come from the container, so the field types don't list them
    expect((input.outputs as Record<string, { value: unknown }>).threshold.value).toBe(9)
    await expect(input.pull()).resolves.toEqual({ value: [1, 2], threshold: 9 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes once when the cache file is corrupt', async () => {
    await lockedDirections('/directions')
    const nodes = await save('/directions')
    const cache = await project.getDirectoryHandle('cache')
    const writable = await (await cache.getFileHandle('directions.json')).createWritable()
    await writable.write('{"version":1,"id":')
    await writable.close()

    const reloaded = await reload(nodes, '/directions')
    const execute = vi.spyOn(reloaded, 'execute').mockResolvedValue({ route })

    expect(reloaded.hasOutput).toBe(false)
    await expect(reloaded.pull()).resolves.toEqual({ route })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('executes once when the cache file belongs to a different operator type', async () => {
    await lockedDirections('/directions')
    const nodes = await save('/directions')
    const cache = await project.getDirectoryHandle('cache')
    const writable = await (await cache.getFileHandle('directions.json')).createWritable()
    await writable.write(cacheFile('/directions', 'NumberOp', { val: 1 }))
    await writable.close()

    const reloaded = await reload(nodes, '/directions')
    const execute = vi.spyOn(reloaded, 'execute').mockResolvedValue({ route })

    await reloaded.pull()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('executes once when outputs fail the schema', async () => {
    await lockedDirections('/directions')
    const nodes = await save('/directions')
    const cache = await project.getDirectoryHandle('cache')
    const writable = await (await cache.getFileHandle('directions.json')).createWritable()
    await writable.write(cacheFile('/directions', 'DirectionsOp', { route: { distance: 'far' } }))
    await writable.close()

    const reloaded = await reload(nodes, '/directions')
    const execute = vi.spyOn(reloaded, 'execute').mockResolvedValue({ route })

    await reloaded.pull()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
