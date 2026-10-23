import { describe, expect, it } from 'vitest'
import type { Field } from '../../noodles/fields'
import { type IOperator, type Operator, opTypes } from '../../noodles/operators'
import { GIS_CONVERSIONS } from './gis-conversions'
import { OP_CATALOG } from './op-catalog'

describe('the operator catalog', () => {
  it('has a plan for every Noodles operator, and nothing else', () => {
    expect(Object.keys(OP_CATALOG).sort()).toEqual(Object.keys(opTypes).sort())
  })
})

describe('the GeoJSON conversions', () => {
  it("read Noodles' own defaults for the inputs noodles.json leaves out", () => {
    const differ: string[] = []
    for (const [type, c] of Object.entries(GIS_CONVERSIONS)) {
      const Class = (opTypes as unknown as Record<string, new (id: string) => Operator<IOperator>>)[
        type
      ]
      const op = new Class(`/__defaults-${type}`)
      for (const [name, value] of Object.entries(c.defaults)) {
        const field = (op.inputs as Record<string, Field>)[name]
        if (!field) differ.push(`${type}.${name}: no such input`)
        else if (JSON.stringify(field.serialize()) !== JSON.stringify(value))
          differ.push(`${type}.${name}: ${JSON.stringify(field.serialize())}`)
      }
    }
    expect(differ).toEqual([])
  })
})
