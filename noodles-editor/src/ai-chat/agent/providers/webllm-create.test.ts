import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The engine factory is the one thing createWebLLMProvider hands the window to,
// so it is mocked to record what it was asked for
const createEngine = vi.hoisted(() =>
  vi.fn(async () => ({
    unload: async () => {},
    interruptGenerate: () => {},
    chat: { completions: { create: async () => [] } },
  }))
)
vi.mock('@mlc-ai/web-llm', () => ({ CreateWebWorkerMLCEngine: createEngine }))

import { createWebLLMProvider, DEFAULT_WEBLLM_MODEL } from './webllm'

describe('createWebLLMProvider', () => {
  const realGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu')

  beforeEach(() => {
    createEngine.mockClear()
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: async () => ({}) },
    })
    vi.stubGlobal(
      'Worker',
      class {
        terminate() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (realGpu) Object.defineProperty(navigator, 'gpu', realGpu)
    else delete (navigator as { gpu?: unknown }).gpu
  })

  it('loads the prebuilt config untouched by default', async () => {
    const provider = await createWebLLMProvider({})

    expect(provider.contextWindow).toBe(4096)
    expect(createEngine).toHaveBeenCalledWith(
      expect.anything(),
      DEFAULT_WEBLLM_MODEL,
      expect.anything(),
      undefined
    )
  })

  it('asks the engine for the window it reports', async () => {
    // A provider that budgets for 16k on an engine left at 4k overflows on the
    // first long turn, so the two have to come from the same number
    const provider = await createWebLLMProvider({ contextWindow: 16_384 })

    expect(provider.contextWindow).toBe(16_384)
    expect(createEngine).toHaveBeenCalledWith(
      expect.anything(),
      DEFAULT_WEBLLM_MODEL,
      expect.anything(),
      { context_window_size: 16_384 }
    )
  })
})
