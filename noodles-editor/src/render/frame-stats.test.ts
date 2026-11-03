import { describe, expect, it } from 'vitest'
import { FrameCounter } from './frame-stats'

// Each frame in its own task, as the browser draws them
async function draw(frames: FrameCounter, times: number[]) {
  for (const t of times) {
    frames.frame(t)
    await Promise.resolve()
  }
}

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step)

describe('FrameCounter', () => {
  it('has no stats before the first frame', () => {
    expect(new FrameCounter().stats(1000)).toBeUndefined()
  })

  it('counts the frames drawn in the last second', async () => {
    const frames = new FrameCounter()
    // 60 frames, about 16.7ms apart
    await draw(
      frames,
      range(0, 60, 1).map(i => 10_000 + Math.round(i * (1000 / 60)))
    )
    expect(frames.stats(10_990)).toEqual({ fps: 60, lastFrameTime: 16, timestamp: 10_983 })
  })

  it('counts one frame when MapLibre calls onAfterRender per layer group in one repaint', async () => {
    const frames = new FrameCounter()
    for (const t of [0, 100, 200]) {
      // Three layer groups and the final pass, all in one task
      for (let call = 0; call < 4; call++) frames.frame(t + call)
      await Promise.resolve()
    }
    expect(frames.stats(250)).toEqual({ fps: 3, lastFrameTime: 100, timestamp: 200 })
  })

  it('reads 0 once nothing has been drawn for a second, keeping the last frame', async () => {
    const frames = new FrameCounter()
    await draw(frames, [10_000, 10_020])
    // A still scene draws no frames, and that is what fps should say
    expect(frames.stats(12_000)).toEqual({ fps: 0, lastFrameTime: 20, timestamp: 10_020 })
  })

  it('follows a change in frame rate within a second', async () => {
    const frames = new FrameCounter()
    await draw(frames, range(0, 1000, 10)) // 100 fps
    await draw(frames, range(1000, 2000, 100)) // then 10 fps
    expect(frames.stats(1999)?.fps).toBe(10)
  })
})
