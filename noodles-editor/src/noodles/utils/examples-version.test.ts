import { describe, expect, it } from 'vitest'
import { NOODLES_VERSION } from './migrate-schema'
import type { NoodlesProjectJSON } from './serialization'

// Import all example project files
const exampleProjects = import.meta.glob('../../examples/**/noodles.json', {
  eager: true,
  import: 'default',
}) as Record<string, NoodlesProjectJSON>

// Import public demo projects
const publicProjects = import.meta.glob('../../../public/noodles/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, NoodlesProjectJSON>

const allProjects = { ...exampleProjects, ...publicProjects }

describe('Example projects version', () => {
  it('should have at least one example project', () => {
    expect(Object.keys(allProjects).length).toBeGreaterThan(0)
  })

  it('all example projects should be at the latest schema version', () => {
    const outdatedProjects: string[] = []

    for (const [path, project] of Object.entries(allProjects)) {
      if (project.version !== NOODLES_VERSION) {
        outdatedProjects.push(
          `${path}: version ${project.version} (expected ${NOODLES_VERSION})`
        )
      }
    }

    if (outdatedProjects.length > 0) {
      throw new Error(
        `The following example projects need to be migrated to version ${NOODLES_VERSION}:\n\n${outdatedProjects.join('\n')}\n\nRun the migration script or manually update each project file.`
      )
    }
  })

  it('all example projects should have a valid version number', () => {
    for (const [path, project] of Object.entries(allProjects)) {
      expect(
        project.version,
        `${path} should have a version field`
      ).toBeDefined()
      expect(
        typeof project.version,
        `${path} version should be a number`
      ).toBe('number')
      expect(
        project.version,
        `${path} version should be positive`
      ).toBeGreaterThanOrEqual(0)
    }
  })
})
