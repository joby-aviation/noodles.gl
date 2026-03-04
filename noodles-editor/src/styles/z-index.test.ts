import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Z_INDEX } from './z-index'

// Maps CSS custom property names to Z_INDEX keys.
// Update both this map and the two source files together whenever tiers change.
const CSS_VAR_MAP: Record<string, keyof typeof Z_INDEX> = {
  '--z-index-background': 'BACKGROUND',
  '--z-index-node-tooltip': 'NODE_TOOLTIP',
  '--z-index-canvas': 'CANVAS',
  '--z-index-chrome': 'CHROME',
  '--z-index-banner': 'BANNER',
  '--z-index-backdrop': 'BACKDROP',
  '--z-index-modal': 'MODAL',
  '--z-index-top': 'TOP',
}

describe('z-index sync', () => {
  const css = readFileSync(resolve(__dirname, '../noodles/noodles.module.css'), 'utf8')

  for (const [cssVar, tsKey] of Object.entries(CSS_VAR_MAP)) {
    it(`${cssVar} matches Z_INDEX.${tsKey}`, () => {
      const match = css.match(new RegExp(`${cssVar}:\\s*(-?\\d+)`))
      expect(match, `${cssVar} not found in noodles.module.css`).toBeTruthy()
      expect(Number(match![1])).toBe(Z_INDEX[tsKey])
    })
  }
})
