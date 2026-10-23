import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import latestFile from '../__migrations__/LATEST?raw'
import { assertUniqueMigrationVersions, NOODLES_VERSION } from './migrate-schema'

// Two PRs that each add a migration with the same number merge without a git conflict,
// and projects saved at that version silently skip one of them. These checks, plus the
// one-line LATEST file every migration PR must change, turn that into a merge conflict
// or a failing test.

const filenames = Object.keys(
  import.meta.glob(['../__migrations__/*.ts', '!../__migrations__/*.test.ts'])
)
  .map(path => basename(path))
  .sort()

const versionOf = (filename: string) => Number(filename.match(/^\d+/)?.[0])
const pad = (version: number) => String(version).padStart(3, '0')

const versions = filenames.map(versionOf)
const highest = Math.max(...versions)
const highestFilename = filenames.find(f => versionOf(f) === highest)?.replace(/\.ts$/, '')
const fixHint = `Rebase on main and renumber yours to ${pad(highest + 1)}, then update __migrations__/LATEST and bump example project versions`

// Migrations run from version 0, so the chain must start at 001
const missingVersions = (nums: number[]) => {
  const missing: string[] = []
  for (let v = 1; v <= Math.max(...nums); v++) {
    if (!nums.includes(v)) missing.push(pad(v))
  }
  return missing
}

describe('migration numbering', () => {
  it('finds migrations', () => {
    expect(filenames.length).toBeGreaterThan(0)
  })

  it('names every migration NNN-kebab-case.ts', () => {
    // Shipped before this rule; renaming it gains nothing
    const grandfathered = ['001-bbox-to-viewState.ts']
    const badNames = filenames.filter(
      f => !grandfathered.includes(f) && !/^\d{3}-[a-z0-9-]+\.ts$/.test(f)
    )
    expect(
      badNames,
      `Rename ${badNames.join(', ')} to a three-digit number and a lowercase kebab-case name, e.g. 020-rename-foo.ts`
    ).toEqual([])
  })

  it('uses each number once', () => {
    const seen = new Map<number, string>()
    for (const filename of filenames) {
      const version = versionOf(filename)
      const other = seen.get(version)
      expect(
        other,
        `Two migrations use ${pad(version)} (${other}, ${filename}). ${fixHint}`
      ).toBeUndefined()
      seen.set(version, filename)
    }
  })

  it('numbers migrations from 001 without gaps', () => {
    const missing = missingVersions(versions)
    expect(
      missing,
      `No migration uses ${missing.join(', ')}. Renumber the migrations above the gap so the numbers are consecutive, then update __migrations__/LATEST`
    ).toEqual([])
  })

  it('records the highest migration in LATEST', () => {
    const lines = latestFile.replace(/\n$/, '').split('\n')
    expect(
      lines,
      `__migrations__/LATEST must be one line with the highest migration's name (${highestFilename}). Every PR that adds a migration updates it so concurrent migration PRs conflict`
    ).toEqual([highestFilename])
  })

  it('sets NOODLES_VERSION to the highest migration number', () => {
    expect(NOODLES_VERSION).toBe(highest)
  })
})

describe('missingVersions', () => {
  it('reports a missing first migration', () => {
    expect(missingVersions([2, 3])).toEqual(['001'])
  })

  it('reports a gap in the middle', () => {
    expect(missingVersions([1, 3])).toEqual(['002'])
  })

  it('accepts a consecutive chain from 001', () => {
    expect(missingVersions([1, 2, 3])).toEqual([])
  })
})

describe('assertUniqueMigrationVersions', () => {
  it('throws with a fix when two migrations share a number', () => {
    expect(() =>
      assertUniqueMigrationVersions([
        '../__migrations__/018-repair-duplicate-edges.ts',
        '../__migrations__/019-rename-bounds-literal-inputs.ts',
        '../__migrations__/019-remove-table-schema-ports.ts',
      ])
    ).toThrow(
      'Two migrations use 019 (019-rename-bounds-literal-inputs.ts, 019-remove-table-schema-ports.ts). Rebase on main and renumber yours to 020, then update __migrations__/LATEST and bump example project versions'
    )
  })

  it('accepts unique numbers', () => {
    expect(() =>
      assertUniqueMigrationVersions([
        '../__migrations__/018-repair-duplicate-edges.ts',
        '../__migrations__/019-rename-bounds-literal-inputs.ts',
      ])
    ).not.toThrow()
  })
})
