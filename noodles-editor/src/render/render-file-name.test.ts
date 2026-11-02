import { describe, expect, it } from 'vitest'
import {
  nextRenderVersion,
  RENDER_EXTENSIONS,
  renderFileName,
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
