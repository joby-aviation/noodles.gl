import { describe, expect, it } from 'vitest'
import {
  nextRenderVersion,
  RENDER_EXTENSIONS,
  renderFileName,
  reserveRenderFile,
  sanitizeRenderBaseName,
} from './render-file-name'

// A directory holding these entries; names ending in / are folders
function directoryWith(names: string[]): FileSystemDirectoryHandle {
  return {
    async *entries() {
      for (const name of names) {
        const kind = name.endsWith('/') ? 'directory' : 'file'
        yield [name.replace(/\/$/, ''), { kind, name }]
      }
    },
  } as unknown as FileSystemDirectoryHandle
}

describe('sanitizeRenderBaseName', () => {
  it('replaces path separators and reserved characters', () => {
    expect(sanitizeRenderBaseName('  Florida/routes:v2  ')).toBe('Florida-routes-v2')
    expect(sanitizeRenderBaseName('a\\b*c?d"e<f>g|h')).toBe('a-b-c-d-e-f-g-h')
  })

  it('drops a render extension the user typed', () => {
    for (const extension of RENDER_EXTENSIONS) {
      expect(sanitizeRenderBaseName(`map.${extension}`)).toBe('map')
    }
    expect(sanitizeRenderBaseName('map.WEBM')).toBe('map')
    // Not a render extension, so part of the name
    expect(sanitizeRenderBaseName('map.final')).toBe('map.final')
  })

  it('strips control characters and leading or trailing dots', () => {
    expect(sanitizeRenderBaseName('line\nbreak\u0000')).toBe('linebreak')
    expect(sanitizeRenderBaseName('..hidden..')).toBe('hidden')
  })

  it('accepts a number from an expression', () => {
    expect(sanitizeRenderBaseName(2026)).toBe('2026')
  })

  it('falls back when nothing usable is left', () => {
    expect(sanitizeRenderBaseName('', 'my-project')).toBe('my-project')
    expect(sanitizeRenderBaseName('  .png ', 'my-project')).toBe('my-project')
    expect(sanitizeRenderBaseName(null, 'my/project')).toBe('my-project')
    expect(sanitizeRenderBaseName({ name: 'map' }, '')).toBe('render')
  })

  it('caps the length so a version and frame number still fit', () => {
    expect(sanitizeRenderBaseName('x'.repeat(400))).toHaveLength(200)
  })

  it('caps the length in bytes without splitting a character', () => {
    // Three bytes each, so 66 fit in 200 bytes
    const name = sanitizeRenderBaseName('航'.repeat(100))
    expect(name).toBe('航'.repeat(66))
    // Two UTF-16 code units, four bytes
    expect(sanitizeRenderBaseName('🛩'.repeat(60))).toBe('🛩'.repeat(50))
    const longest = renderFileName({
      baseName: name,
      version: 999,
      extension: 'jpeg',
      frame: '99999',
    })
    expect(new TextEncoder().encode(longest).length).toBeLessThanOrEqual(255)
  })

  it('keeps Windows device names out', () => {
    expect(sanitizeRenderBaseName('CON')).toBe('CON_')
    expect(sanitizeRenderBaseName('nul.png')).toBe('nul_')
    expect(sanitizeRenderBaseName('com1.final')).toBe('com1.final_')
    expect(sanitizeRenderBaseName('', 'aux')).toBe('aux_')
    // Only the whole name is reserved
    expect(sanitizeRenderBaseName('console')).toBe('console')
  })
})

describe('renderFileName', () => {
  it('adds the version, then the frame number for a sequence', () => {
    expect(renderFileName({ baseName: 'map', version: 3, extension: 'webm' })).toBe('map-v3.webm')
    expect(renderFileName({ baseName: 'map', version: 1, extension: 'exr', frame: '0042' })).toBe(
      'map-v1_0042.exr'
    )
  })
})

describe('nextRenderVersion', () => {
  it('starts a new name at version one', async () => {
    expect(await nextRenderVersion(directoryWith([]), 'map')).toBe(1)
  })

  it('counts every render format and image sequence frames', async () => {
    const directory = directoryWith([
      'LA-vertistop-v1.png',
      'LA-vertistop-v2.mp4',
      'LA-vertistop-v3.webm',
      'LA-vertistop-v4_0000.exr',
      'LA-vertistop-v5.JPEG',
    ])
    expect(await nextRenderVersion(directory, 'LA-vertistop')).toBe(6)
  })

  it('ignores other names, other files and folders', async () => {
    const directory = directoryWith([
      'another-render-v20.png',
      'LA-vertistop-extra-v9.png',
      'LA-vertistop-v8.txt',
      'LA-vertistop-v7/',
      'LA-vertistop.png',
    ])
    expect(await nextRenderVersion(directory, 'LA-vertistop')).toBe(1)
  })

  it('treats regular expression characters in the name literally', async () => {
    const directory = directoryWith(['a+b-v2.png', 'aab-v9.png'])
    expect(await nextRenderVersion(directory, 'a+b')).toBe(3)
  })
})

describe('reserveRenderFile', () => {
  // A folder that keeps the files created in it, and can refuse to delete them
  function writableDirectory(names: string[] = [], { lockedFiles = false } = {}) {
    const files = new Set(names)
    const handle = {
      async *entries() {
        for (const name of files) yield [name, { kind: 'file', name }]
      },
      async getFileHandle(name: string) {
        files.add(name)
        return { kind: 'file', name }
      },
      async removeEntry(name: string) {
        if (lockedFiles) throw new DOMException('The file is in use', 'NoModificationAllowedError')
        files.delete(name)
      },
    } as unknown as FileSystemDirectoryHandle
    return { files, handle }
  }

  it('creates the next version so the folder already shows it as taken', async () => {
    const { files, handle } = writableDirectory(['map-v1.png'])
    const reservation = await reserveRenderFile(handle, { baseName: 'map', extension: 'mp4' })
    expect(reservation).toMatchObject({ name: 'map-v2.mp4', version: 2 })
    expect(files.has('map-v2.mp4')).toBe(true)
  })

  it('gives exports started together their own versions', async () => {
    const { handle } = writableDirectory()
    const names = await Promise.all([
      reserveRenderFile(handle, { baseName: 'shared', extension: 'png' }),
      reserveRenderFile(handle, { baseName: 'shared', extension: 'webm' }),
      reserveRenderFile(handle, { baseName: 'shared', extension: 'exr', frame: '0000' }),
    ])
    expect(names.map(reservation => reservation.name)).toEqual([
      'shared-v1.png',
      'shared-v2.webm',
      'shared-v3_0000.exr',
    ])
  })

  it('keeps reserving after one reservation fails', async () => {
    const { handle } = writableDirectory()
    const failing = {
      entries: () => {
        throw new DOMException('The folder was removed', 'NotFoundError')
      },
    } as unknown as FileSystemDirectoryHandle
    await expect(reserveRenderFile(failing, { baseName: 'map', extension: 'png' })).rejects.toThrow(
      'removed'
    )
    const next = await reserveRenderFile(handle, { baseName: 'map', extension: 'png' })
    expect(next.name).toBe('map-v1.png')
  })

  it('deletes the reserved file when discarded, and frees its version', async () => {
    const { files, handle } = writableDirectory()
    const reservation = await reserveRenderFile(handle, { baseName: 'map', extension: 'mp4' })
    await reservation.discard()
    expect(files.has('map-v1.mp4')).toBe(false)
    const retry = await reserveRenderFile(handle, { baseName: 'map', extension: 'mp4' })
    expect(retry.name).toBe('map-v1.mp4')
  })

  it('does not throw when the reserved file cannot be deleted', async () => {
    const { handle } = writableDirectory([], { lockedFiles: true })
    const reservation = await reserveRenderFile(handle, { baseName: 'map', extension: 'png' })
    await expect(reservation.discard()).resolves.toBeUndefined()
  })
})
