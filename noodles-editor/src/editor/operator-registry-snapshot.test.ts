// noodles-validate checks documents in plain Node, where the host operators can't load, so it
// reads this snapshot of the catalog instead. A changed operator fails this test until the
// snapshot is regenerated:
//
//   npm run generate:registry

import { describe, expect, it } from 'vitest'
import { registerHostOperators } from '../runtime/host/host-ops'
import { registerNoodlesRamps } from '../runtime/ramps'
import { operatorRegistry } from './operator-registry'

describe('operator registry snapshot', () => {
  it('matches noodles-validate/registry.json (run npm run generate:registry)', async () => {
    registerNoodlesRamps()
    registerHostOperators()
    const json = `${JSON.stringify(operatorRegistry(), null, 2)}\n`
    await expect(json).toMatchFileSnapshot('../../../noodles-validate/registry.json')
  })
})
