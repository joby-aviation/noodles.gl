import { describe, expect, it } from 'vitest'
import { normalizeBaseUrl } from './custom'
import { ENDPOINT_PRESETS } from './endpoint-presets'

describe('ENDPOINT_PRESETS', () => {
  // A preset whose URL the provider then rewrites is a preset that cannot be
  // matched back to its "get a key" link
  it('stores base URLs already in the shape the provider normalises to', () => {
    for (const preset of ENDPOINT_PRESETS) {
      expect(normalizeBaseUrl(preset.baseUrl)).toBe(preset.baseUrl)
    }
  })

  it('names a model and a place to get a key for every preset', () => {
    for (const preset of ENDPOINT_PRESETS) {
      expect(preset.model).not.toBe('')
      expect(preset.signupUrl).toMatch(/^https:\/\//)
      expect(preset.note).not.toBe('')
    }
  })

  it('has no duplicate ids, since the id is the analytics label', () => {
    const ids = ENDPOINT_PRESETS.map(preset => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
