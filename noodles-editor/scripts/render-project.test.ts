import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { browserArgs, parseRenderArgs, projectIdOf, readProjectFiles } from './render-project'

let dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })))
  dirs = []
})
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'render-project-'))
  dirs.push(dir)
  return dir
}
const PROJECT = { version: 1, name: 'title', nodes: [], edges: [] }

describe('parseRenderArgs', () => {
  it('reads a project, an output and the render settings', () => {
    const args = parseRenderArgs(
      [
        'proj',
        '--out',
        'out/a.mp4',
        '--start',
        '0',
        '--end',
        '7.5',
        '--fps',
        '30',
        '--codec',
        'vp9',
      ],
      '/work'
    )
    expect(args).toEqual({
      ok: true,
      options: expect.objectContaining({
        project: '/work/proj',
        out: '/work/out/a.mp4',
        startTime: 0,
        endTime: 7.5,
        fps: 30,
        codec: 'vp9',
        timeoutSeconds: 1800,
        json: false,
      }),
    })
  })

  it('leaves out settings that are not given, for the project to supply', () => {
    const args = parseRenderArgs(['proj', '-o', 'a.mp4', '--url', 'http://localhost:5173/'], '/w')
    expect(args.ok && args.options).toMatchObject({ url: 'http://localhost:5173', fps: undefined })
  })

  it('says what is wrong with a bad command line', () => {
    const error = (argv: string[]) => {
      const r = parseRenderArgs(argv)
      return r.ok ? '' : r.error
    }
    expect(error(['--out', 'a.mp4'])).toMatch(/one project/)
    expect(error(['proj'])).toMatch(/--out is required/)
    expect(error(['proj', '--out', 'a.mp4', '--fps', 'fast'])).toMatch(/--fps must be a number/)
    expect(error(['proj', '--out', 'a.mp4', '--codec', 'h264'])).toMatch(/--codec must be one of/)
    expect(error(['proj', '--out', 'a.mp4', '--frobnicate'])).toMatch(/frobnicate/)
  })
})

describe('readProjectFiles', () => {
  it("names a saved project's data/ files as @/ does", async () => {
    const dir = join(await tempDir(), 'My Title')
    await mkdir(join(dir, 'data', 'tiles'), { recursive: true })
    await writeFile(join(dir, 'noodles.json'), JSON.stringify(PROJECT))
    await writeFile(join(dir, 'data', 'points.csv'), 'a,b\n1,2\n')
    await writeFile(join(dir, 'data', 'tiles', 'a.png'), Buffer.from([1, 2, 3]))
    const read = await readProjectFiles(dir)
    expect(read.id).toBe('render-My-Title')
    expect(read.project).toEqual(PROJECT)
    expect(Object.keys(read.files).sort()).toEqual(['points.csv', 'tiles/a.png'])
    expect(Buffer.from(read.files['points.csv'], 'base64').toString()).toBe('a,b\n1,2\n')
  })

  it("names an example's files beside noodles.json, without the project or its README", async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'noodles.json'), JSON.stringify(PROJECT))
    await writeFile(join(dir, 'README.md'), '# hi')
    await writeFile(join(dir, 'data.csv'), 'x\n1\n')
    await mkdir(join(dir, '.agent'))
    await writeFile(join(dir, '.agent', 'notes.txt'), 'skip')
    const read = await readProjectFiles(join(dir, 'noodles.json'))
    expect(Object.keys(read.files)).toEqual(['data.csv'])
  })
})

describe('projectIdOf and browserArgs', () => {
  it('makes a plain id from any folder name', () => {
    expect(projectIdOf('/a/b/world flights!')).toBe('render-world-flights')
    expect(projectIdOf('/')).toBe('render-project')
  })

  it('asks for Metal on macOS, so WebGL does not fall back to SwiftShader', () => {
    expect(browserArgs('darwin')).toContain('--use-angle=metal')
    expect(browserArgs('linux')).not.toContain('--use-angle=metal')
  })
})
