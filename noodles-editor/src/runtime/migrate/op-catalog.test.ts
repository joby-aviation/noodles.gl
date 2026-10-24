import { describe, expect, it } from 'vitest'
import type { Field } from '../../noodles/fields'
import { type IOperator, type Operator, opTypes } from '../../noodles/operators'
import { GIS_CONVERSIONS } from './gis-conversions'
import { OP_CATALOG } from './op-catalog'
import { DEFAULTS } from './to-editor-doc'

describe('the operator catalog', () => {
  // The catalog names every operator older projects can hold; only the classes that still run
  // (host operators, and those whose fields a parameter uses) are left in Noodles
  it('has a plan for every Noodles operator class still in the editor', () => {
    expect(Object.keys(opTypes).filter(type => !OP_CATALOG[type])).toEqual([])
  })
})

// #fff, #ffffff and #ffffffff are one color
const sameColor = (v: unknown) => {
  if (typeof v !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v
  const hex = v.length === 4 ? `#${[...v.slice(1)].map(c => c + c).join('')}` : v
  return (hex.length === 7 ? `${hex}ff` : hex).toLowerCase()
}

describe('the conversions', () => {
  // Checked against the classes before they were removed; still checked where a class remains
  it("read Noodles' own defaults for the inputs noodles.json leaves out", () => {
    const differ: string[] = []
    const tables = [
      ...Object.entries(GIS_CONVERSIONS).map(([type, c]) => [type, c.defaults] as const),
      ...Object.entries(DEFAULTS),
    ]
    const classes = opTypes as unknown as Record<string, new (id: string) => Operator<IOperator>>
    for (const [type, defaults] of tables) {
      const Class = classes[type]
      if (!Class) continue
      const op = new Class(`/__defaults-${type}`)
      for (const [name, value] of Object.entries(defaults)) {
        const field = (op.inputs as Record<string, Field>)[name]
        if (!field) differ.push(`${type}.${name}: no such input`)
        else if (JSON.stringify(sameColor(field.serialize())) !== JSON.stringify(sameColor(value)))
          differ.push(`${type}.${name}: ${JSON.stringify(field.serialize())}`)
      }
    }
    expect(differ).toEqual([])
  })
})
