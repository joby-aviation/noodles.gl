import { describe, expect, it } from 'vitest'
import { opTypes } from '../../noodles/operators'
import { OP_CATALOG } from './op-catalog'

describe('the operator catalog', () => {
  it('has a plan for every Noodles operator, and nothing else', () => {
    expect(Object.keys(OP_CATALOG).sort()).toEqual(Object.keys(opTypes).sort())
  })
})
