import { describe, expect, it } from 'vitest'
import {
  generateQualifiedPath,
  getBaseName,
  getParentPath,
  isAbsolutePath,
  isValidPath,
  joinPath,
  normalizePath,
  parseHandleId,
  resolvePath,
} from './path-utils'

describe('isAbsolutePath', () => {
  it('returns true for absolute paths', () => {
    expect(isAbsolutePath('/')).toBe(true)
    expect(isAbsolutePath('/operator')).toBe(true)
    expect(isAbsolutePath('/container/operator')).toBe(true)
  })

  it('returns false for relative paths', () => {
    expect(isAbsolutePath('')).toBe(false)
    expect(isAbsolutePath('operator')).toBe(false)
    expect(isAbsolutePath('./operator')).toBe(false)
    expect(isAbsolutePath('../operator')).toBe(false)
  })
})

describe('getParentPath', () => {
  it('returns / for root path', () => {
    expect(getParentPath('/')).toBe('/')
  })

  it('returns undefined for undefined path', () => {
    expect(getParentPath('')).toBeUndefined()
    expect(getParentPath(undefined)).toBeUndefined()
  })

  it('returns root for top-level operators', () => {
    expect(getParentPath('/operator')).toBe('/')
    expect(getParentPath('/code1')).toBe('/')
  })

  it('returns parent path for nested operators', () => {
    expect(getParentPath('/container/operator')).toBe('/container')
    expect(getParentPath('/container/subcontainer/operator')).toBe('/container/subcontainer')
  })

  it('handles trailing slashes', () => {
    expect(getParentPath('/container/operator/')).toBe('/container')
  })

  it('returns undefined for invalid paths', () => {
    expect(getParentPath('invalid')).toBeUndefined()
  })
})

describe('getBaseName', () => {
  it('returns empty string for empty path', () => {
    expect(getBaseName('')).toBe('')
  })

  it('returns base name for simple paths', () => {
    expect(getBaseName('operator')).toBe('operator')
    expect(getBaseName('/operator')).toBe('operator')
  })

  it('returns base name for nested paths', () => {
    expect(getBaseName('/container/operator')).toBe('operator')
    expect(getBaseName('/container/subcontainer/operator')).toBe('operator')
  })

  it('handles trailing slashes', () => {
    expect(getBaseName('/container/operator/')).toBe('operator')
  })
})

describe('normalizePath', () => {
  it('returns root for empty path', () => {
    expect(normalizePath('')).toBe('/')
  })

  it('normalizes simple paths', () => {
    expect(normalizePath('operator')).toBe('/operator')
    expect(normalizePath('/operator')).toBe('/operator')
  })

  it('removes redundant segments', () => {
    expect(normalizePath('/container/./operator')).toBe('/container/operator')
    expect(normalizePath('/container/../operator')).toBe('/operator')
    expect(normalizePath('/container/sub/../operator')).toBe('/container/operator')
  })

  it('handles complex paths with multiple redundant segments', () => {
    expect(normalizePath('/container/./sub/../operator')).toBe('/container/operator')
    expect(normalizePath('/container/sub/../../operator')).toBe('/operator')
  })

  it('handles going above root', () => {
    expect(normalizePath('/../operator')).toBe('/operator')
    expect(normalizePath('/../../operator')).toBe('/operator')
  })
})

describe('resolvePath', () => {
  describe('absolute paths', () => {
    it('resolves absolute paths directly', () => {
      expect(resolvePath('/target', '/current/operator')).toBe('/target')
      expect(resolvePath('/container/target', '/current/operator')).toBe('/container/target')
    })

    it('normalizes absolute paths', () => {
      expect(resolvePath('/container/../target', '/current/operator')).toBe('/target')
    })
  })

  describe('relative paths with ./', () => {
    it('resolves same-container references', () => {
      expect(resolvePath('./target', '/container/operator')).toBe('/container/target')
      expect(resolvePath('./sub/target', '/container/operator')).toBe('/container/sub/target')
    })

    it('handles root-level context', () => {
      expect(resolvePath('./target', '/operator')).toBe('/target')
    })
  })

  describe('relative paths with ../', () => {
    it('resolves parent-container references', () => {
      expect(resolvePath('../target', '/container/operator')).toBe('/target')
      expect(resolvePath('../other/target', '/container/operator')).toBe('/other/target')
    })

    it('handles multiple parent references', () => {
      expect(resolvePath('../../target', '/container/sub/operator')).toBe('/target')
    })

    it('resolves paths that go above root', () => {
      expect(resolvePath('../target', '/operator')).toBe('/target')
      expect(resolvePath('../../target', '/container/operator')).toBe('/target')
    })
  })

  describe('relative paths without prefix', () => {
    it('treats as same-container references', () => {
      expect(resolvePath('target', '/container/operator')).toBe('/container/target')
      expect(resolvePath('sub/target', '/container/operator')).toBe('/container/sub/target')
    })
  })

  describe('edge cases', () => {
    it('returns undefined for empty path', () => {
      expect(resolvePath('', '/container/operator')).toBeUndefined()
    })

    it('returns undefined for invalid context', () => {
      expect(resolvePath('target', '')).toBeUndefined()
    })
  })
})

describe('joinPath', () => {
  it('joins simple segments', () => {
    expect(joinPath('container', 'operator')).toBe('/container/operator')
    expect(joinPath('/', 'operator')).toBe('/operator')
  })

  it('filters empty segments', () => {
    expect(joinPath('container', '', 'operator')).toBe('/container/operator')
  })

  it('normalizes the result', () => {
    expect(joinPath('container', '../operator')).toBe('/operator')
  })
})

describe('isValidPath', () => {
  it('returns true for valid absolute paths', () => {
    expect(isValidPath('/')).toBe(true)
    expect(isValidPath('/operator')).toBe(true)
    expect(isValidPath('/container/operator')).toBe(true)
  })

  it('returns false for invalid paths', () => {
    expect(isValidPath('')).toBe(false)
    expect(isValidPath('operator')).toBe(false) // Not absolute
    expect(isValidPath('/operator/')).toBe(false) // Trailing slash
    expect(isValidPath('//operator')).toBe(false) // Double slash
    expect(isValidPath('/operator\0')).toBe(false) // Null character
  })
})

describe('generateQualifiedPath', () => {
  it('generates root-level paths', () => {
    expect(generateQualifiedPath('operator', '/')).toBe('/operator')
  })

  it('generates nested paths', () => {
    expect(generateQualifiedPath('operator', 'container')).toBe('/container/operator')
    expect(generateQualifiedPath('operator', '/container')).toBe('/container/operator')
  })

  it('handles complex container paths', () => {
    expect(generateQualifiedPath('operator', '/container/sub')).toBe('/container/sub/operator')
  })
})

describe('parseHandleId', () => {
  it('parses short format handle IDs', () => {
    expect(parseHandleId('par.data')).toEqual({
      namespace: 'par',
      fieldName: 'data',
    })

    expect(parseHandleId('out.result')).toEqual({
      namespace: 'out',
      fieldName: 'result',
    })
  })

  it('handles field names with dots in short format', () => {
    expect(parseHandleId('par.field.name')).toEqual({
      namespace: 'par',
      fieldName: 'field.name',
    })
  })

  it('returns undefined for invalid handle IDs', () => {
    expect(parseHandleId('')).toBeUndefined()
    expect(parseHandleId('invalid')).toBeUndefined()
    expect(parseHandleId('operator.invalid.field')).toBeUndefined() // Invalid namespace
    expect(parseHandleId('random.text')).toBeUndefined() // Not valid format
  })
})

describe('integration tests', () => {
  it('complex path resolution scenarios', () => {
    // Test a complex nested scenario
    const contextOp = '/analysis/preprocessing/filter'

    // Same container reference
    expect(resolvePath('transform', contextOp)).toBe('/analysis/preprocessing/transform')

    // Parent container reference
    expect(resolvePath('../postprocessing/aggregate', contextOp)).toBe(
      '/analysis/postprocessing/aggregate'
    )

    // Absolute reference
    expect(resolvePath('/visualization/chart', contextOp)).toBe('/visualization/chart')

    // Complex relative reference
    expect(resolvePath('../../output/display', contextOp)).toBe('/output/display')
  })

  it('comprehensive path utilities workflow', () => {
    // Test the complete workflow from path generation to resolution

    // 1. Generate qualified paths for different containers
    const rootOp = generateQualifiedPath('code', '/')
    const containerOp = generateQualifiedPath('transform', '/analysis')
    const nestedOp = generateQualifiedPath('filter', '/analysis/preprocessing')

    expect(rootOp).toBe('/code')
    expect(containerOp).toBe('/analysis/transform')
    expect(nestedOp).toBe('/analysis/preprocessing/filter')

    // 2. Test path resolution between these operators
    expect(resolvePath('./transform', nestedOp)).toBe('/analysis/preprocessing/transform')
    expect(resolvePath('../transform', nestedOp)).toBe('/analysis/transform')
    expect(resolvePath('/code', nestedOp)).toBe('/code')

    // 3. Test handle ID generation and parsing
    const handleId = 'out.result'
    expect(handleId).toBe('out.result')

    const parsed = parseHandleId(handleId)
    expect(parsed).toEqual({
      namespace: 'out',
      fieldName: 'result',
    })

    // 4. Test path manipulation utilities
    expect(getParentPath(nestedOp)).toBe('/analysis/preprocessing')
    expect(getBaseName(nestedOp)).toBe('filter')
    expect(isAbsolutePath(nestedOp)).toBe(true)
    expect(isValidPath(nestedOp)).toBe(true)

    // 5. Test normalization
    const unnormalizedPath = '/analysis/preprocessing/../transform/./filter'
    expect(normalizePath(unnormalizedPath)).toBe('/analysis/transform/filter')
  })
})
