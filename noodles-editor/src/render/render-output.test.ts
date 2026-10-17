import { describe, expect, it } from 'vitest'
import {
  getNextRenderVersion,
  getVersionedRenderFileName,
  sanitizeRenderBaseName,
} from './render-output'

function mockDirectory(names: string[]): FileSystemDirectoryHandle {
  const files = new Set(names)
  return {
    async *entries() {
      for (const name of files) {
        yield [name, { kind: 'file', name }] as [string, FileSystemFileHandle]
      }
    },
    async getFileHandle(name: string) {
      files.add(name)
      return { kind: 'file', name } as FileSystemFileHandle
    },
  } as FileSystemDirectoryHandle
}

describe('render output names', () => {
  it('sanitizes file names and removes render extensions', () => {
    expect(sanitizeRenderBaseName('  Florida/routes:v2.png  ')).toBe('Florida-routes-v2')
    expect(sanitizeRenderBaseName('', 'my-project')).toBe('my-project')
  })

  it('increments versions across render formats and image sequences', async () => {
    const directory = mockDirectory([
      'LA-vertistop-v1.png',
      'LA-vertistop-v2.mp4',
      'LA-vertistop-v4_0000.png',
      'another-render-v20.png',
    ])

    await expect(getNextRenderVersion(directory, 'LA-vertistop')).resolves.toEqual({
      baseName: 'LA-vertistop',
      version: 5,
    })
    await expect(getVersionedRenderFileName(directory, 'LA-vertistop', '.png')).resolves.toBe(
      'LA-vertistop-v5.png'
    )
  })

  it('starts new render names at version one', async () => {
    await expect(getVersionedRenderFileName(mockDirectory([]), 'new-render', 'mp4')).resolves.toBe(
      'new-render-v1.mp4'
    )
  })

  it('reserves distinct versions for concurrent exports', async () => {
    const directory = mockDirectory([])

    await expect(
      Promise.all([
        getVersionedRenderFileName(directory, 'shared-render', 'png'),
        getVersionedRenderFileName(directory, 'shared-render', 'mp4'),
      ])
    ).resolves.toEqual(['shared-render-v1.png', 'shared-render-v2.mp4'])
  })
})
