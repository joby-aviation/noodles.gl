import { describe, expect, it } from 'vitest'
import {
  convertReferenceFormat,
  formatReference,
  parseReference,
  type ParsedReference,
} from './reference-utils'

describe('parseReference', () => {
  describe('code format', () => {
    it('parses absolute code reference', () => {
      const result = parseReference("op('/operator').par.field")
      expect(result).toEqual({
        opPath: '/operator',
        namespace: 'par',
        fieldName: 'field',
      })
    })

    it('parses relative code reference', () => {
      const result = parseReference("op('./sibling').par.field")
      expect(result).toEqual({
        opPath: './sibling',
        namespace: 'par',
        fieldName: 'field',
      })
    })

    it('parses code reference with double quotes', () => {
      const result = parseReference('op("/container/operator").out.result')
      expect(result).toEqual({
        opPath: '/container/operator',
        namespace: 'out',
        fieldName: 'result',
      })
    })

    it('parses code reference with nested path', () => {
      const result = parseReference("op('/container/sub/operator').par.data")
      expect(result).toEqual({
        opPath: '/container/sub/operator',
        namespace: 'par',
        fieldName: 'data',
      })
    })
  })

  describe('mustache format', () => {
    it('parses absolute mustache reference', () => {
      const result = parseReference('{{/operator.par.field}}')
      expect(result).toEqual({
        opPath: '/operator',
        namespace: 'par',
        fieldName: 'field',
      })
    })

    it('parses relative mustache reference', () => {
      const result = parseReference('{{./sibling.par.field}}')
      expect(result).toEqual({
        opPath: './sibling',
        namespace: 'par',
        fieldName: 'field',
      })
    })

    it('parses mustache reference with nested path', () => {
      const result = parseReference('{{/container/sub/operator.out.result}}')
      expect(result).toEqual({
        opPath: '/container/sub/operator',
        namespace: 'out',
        fieldName: 'result',
      })
    })
  })

  describe('invalid input', () => {
    it('returns null for invalid format', () => {
      expect(parseReference('invalid')).toBeNull()
      expect(parseReference('op(path).par.field')).toBeNull() // missing quotes
      expect(parseReference('{{path.par.field')).toBeNull() // missing closing brace
      expect(parseReference('op("/path")')).toBeNull() // missing field access
    })

    it('returns null for empty string', () => {
      expect(parseReference('')).toBeNull()
    })
  })
})

describe('formatReference', () => {
  const ref: ParsedReference = {
    opPath: '/container/operator',
    namespace: 'par',
    fieldName: 'data',
  }

  it('formats as code', () => {
    const result = formatReference(ref, 'code')
    expect(result).toBe("op('/container/operator').par.data")
  })

  it('formats as mustache', () => {
    const result = formatReference(ref, 'mustache')
    expect(result).toBe('{{/container/operator.par.data}}')
  })

  it('formats relative path as code', () => {
    const relativeRef: ParsedReference = {
      opPath: '../sibling',
      namespace: 'out',
      fieldName: 'result',
    }
    const result = formatReference(relativeRef, 'code')
    expect(result).toBe("op('../sibling').out.result")
  })

  it('formats relative path as mustache', () => {
    const relativeRef: ParsedReference = {
      opPath: './sibling',
      namespace: 'par',
      fieldName: 'value',
    }
    const result = formatReference(relativeRef, 'mustache')
    expect(result).toBe('{{./sibling.par.value}}')
  })
})

describe('convertReferenceFormat', () => {
  it('converts code to mustache', () => {
    const result = convertReferenceFormat("op('/operator').par.field", 'mustache')
    expect(result).toBe('{{/operator.par.field}}')
  })

  it('converts mustache to code', () => {
    const result = convertReferenceFormat('{{/operator.par.field}}', 'code')
    expect(result).toBe("op('/operator').par.field")
  })

  it('converts code to code (no-op)', () => {
    const input = "op('/operator').par.field"
    const result = convertReferenceFormat(input, 'code')
    expect(result).toBe("op('/operator').par.field")
  })

  it('converts mustache to mustache (no-op)', () => {
    const input = '{{/operator.par.field}}'
    const result = convertReferenceFormat(input, 'mustache')
    expect(result).toBe('{{/operator.par.field}}')
  })

  it('preserves relative paths in conversion', () => {
    const codeResult = convertReferenceFormat("op('./sibling').par.field", 'mustache')
    expect(codeResult).toBe('{{./sibling.par.field}}')

    const mustacheResult = convertReferenceFormat('{{../parent.out.result}}', 'code')
    expect(mustacheResult).toBe("op('../parent').out.result")
  })

  it('returns null for invalid input', () => {
    expect(convertReferenceFormat('invalid', 'code')).toBeNull()
    expect(convertReferenceFormat('', 'mustache')).toBeNull()
  })
})

describe('round-trip conversions', () => {
  it('maintains reference through code → mustache → code', () => {
    const original = "op('/container/operator').par.field"
    const mustache = convertReferenceFormat(original, 'mustache')
    const backToCode = convertReferenceFormat(mustache!, 'code')
    expect(backToCode).toBe(original)
  })

  it('maintains reference through mustache → code → mustache', () => {
    const original = '{{/container/operator.out.result}}'
    const code = convertReferenceFormat(original, 'code')
    const backToMustache = convertReferenceFormat(code!, 'mustache')
    expect(backToMustache).toBe(original)
  })

  it('maintains relative paths through conversions', () => {
    const original = "op('../sibling').par.value"
    const mustache = convertReferenceFormat(original, 'mustache')
    expect(mustache).toBe('{{../sibling.par.value}}')
    const backToCode = convertReferenceFormat(mustache!, 'code')
    expect(backToCode).toBe(original)
  })
})
