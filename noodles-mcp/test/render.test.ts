import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { parseProgress, type RenderProgress, renderCommand, runRender } from '../src/render.ts'

describe('renderCommand', () => {
  it("runs the editor's render CLI with JSON progress and only the settings given", () => {
    const { command, args, cwd, out } = renderCommand('/repo', '/work', {
      project: 'proj',
      out: 'renders/a.mp4',
      endTime: 7.5,
      codec: 'vp9',
    })
    assert.equal(command, '/repo/node_modules/.bin/tsx')
    assert.equal(cwd, '/repo/noodles-editor')
    assert.equal(out, '/work/renders/a.mp4')
    assert.deepEqual(args, [
      '/repo/noodles-editor/scripts/render-project.ts',
      '/work/proj',
      '--out',
      '/work/renders/a.mp4',
      '--json',
      '--end',
      '7.5',
      '--codec',
      'vp9',
    ])
  })
})

describe('parseProgress', () => {
  it('reads status lines and passes over the rest', () => {
    assert.deepEqual(parseProgress('{"state":"running","frame":3,"totalFrames":10}'), {
      state: 'running',
      frame: 3,
      totalFrames: 10,
    })
    assert.equal(parseProgress('opening render-x (2 data files)'), undefined)
    assert.equal(parseProgress('{not json'), undefined)
    assert.equal(parseProgress('{"other":1}'), undefined)
  })
})

describe('runRender', () => {
  // A checkout whose tsx is a script standing in for the render CLI
  const repo = mkdtempSync(join(tmpdir(), 'noodles-render-'))
  mkdirSync(join(repo, 'node_modules/.bin'), { recursive: true })
  mkdirSync(join(repo, 'noodles-editor'))
  const fake = (body: string) => {
    const tsx = join(repo, 'node_modules/.bin/tsx')
    writeFileSync(tsx, `#!/bin/sh\n${body}\n`)
    chmodSync(tsx, 0o755)
  }
  after(() => rmSync(repo, { recursive: true, force: true }))

  it('streams progress and resolves with the file', async () => {
    fake(`echo 'opening render-x (0 data files)' >&2
echo '{"state":"running","frame":1,"totalFrames":2}' >&2
echo '{"state":"done","frame":2,"totalFrames":2}' >&2
echo 'wrote out.mp4' >&2`)
    const seen: RenderProgress[] = []
    const outcome = await runRender(repo, '/work', { project: 'p', out: 'out.mp4' }, p =>
      seen.push(p)
    )
    assert.deepEqual(
      seen.map(p => p.state),
      ['running', 'done']
    )
    assert.deepEqual(outcome, {
      ok: true,
      file: '/work/out.mp4',
      log: ['opening render-x (0 data files)', 'wrote out.mp4'],
    })
  })

  it('stops the render when the call is cancelled', async () => {
    fake(`trap 'echo stopped >&2; exit 143' TERM
echo '{"state":"running","frame":1,"totalFrames":100}' >&2
while true; do sleep 0.05; done`)
    const controller = new AbortController()
    const outcome = await runRender(
      repo,
      '/work',
      { project: 'p', out: 'out.mp4' },
      p => {
        if (p.state === 'running') controller.abort()
      },
      controller.signal
    )
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.error, 'The render was cancelled')
  })

  it('reports why a render failed', async () => {
    fake(`echo 'Render failed: Frame 3 did not finish drawing within 120s' >&2
exit 1`)
    const outcome = await runRender(repo, '/work', { project: 'p', out: 'out.mp4' })
    assert.equal(outcome.ok, false)
    assert.equal(
      !outcome.ok && outcome.error,
      'Render failed: Frame 3 did not finish drawing within 120s'
    )
  })
})
