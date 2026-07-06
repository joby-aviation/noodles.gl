// Rubric loading + the no-bare-scales gate (07 D4): every dimension must be
// style: anchors (with levels 0-4) or style: checklist (with criteria); a
// rubric containing a dimension with neither is rejected here, before any
// judge runs. applicable_when is tag-matched against the task's tags here —
// never by the judge.

import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'
import { RUBRICS_ROOT } from './config'

export interface ChecklistCriterion {
  id: string
  text: string
  applicable_when?: string
}

export interface RubricDimension {
  name: string
  style: 'anchors' | 'checklist'
  weight: number
  informational?: boolean
  aggregate?: string
  criteria?: ChecklistCriterion[]
  levels?: Record<number, string>
}

export interface Rubric {
  rubricVersion: number
  family: string
  dimensions: RubricDimension[]
}

export function loadRubric(fileName: string): Rubric {
  const file = path.join(RUBRICS_ROOT, fileName)
  const raw = YAML.parse(fs.readFileSync(file, 'utf-8'))
  if (typeof raw.rubricVersion !== 'number') throw new Error(`${fileName}: missing rubricVersion`)

  const dimensions: RubricDimension[] = []
  for (const [name, dim] of Object.entries(raw.dimensions ?? {}) as Array<[string, Record<string, unknown>]>) {
    const style = dim.style
    if (style !== 'anchors' && style !== 'checklist') {
      throw new Error(
        `${fileName}: dimension "${name}" declares no valid style — bare scales are forbidden (07 D4); use anchors or checklist`
      )
    }
    if (style === 'anchors') {
      const levels = dim.levels as Record<number, string> | undefined
      const keys = Object.keys(levels ?? {}).map(Number)
      if (!levels || keys.length !== 5 || ![0, 1, 2, 3, 4].every(k => keys.includes(k))) {
        throw new Error(`${fileName}: anchors dimension "${name}" must describe every level 0-4`)
      }
    }
    if (style === 'checklist') {
      const criteria = dim.criteria as ChecklistCriterion[] | undefined
      if (!Array.isArray(criteria) || criteria.length === 0 || criteria.some(c => !c.id || !c.text)) {
        throw new Error(`${fileName}: checklist dimension "${name}" needs criteria with id + text`)
      }
    }
    if (typeof dim.weight !== 'number') {
      throw new Error(`${fileName}: dimension "${name}" has no weight — weights live in the YAML, not the judge`)
    }
    dimensions.push({ name, ...(dim as object) } as RubricDimension)
  }
  if (dimensions.length === 0) throw new Error(`${fileName}: no dimensions`)
  return { rubricVersion: raw.rubricVersion, family: raw.family, dimensions }
}

/** Resolve applicable_when clauses against task tags (format: "tag:<name>"). */
export function resolveApplicability(rubric: Rubric, tags: string[]): Rubric {
  const tagSet = new Set(tags)
  const dimensions = rubric.dimensions.map(dim => {
    if (dim.style !== 'checklist' || !dim.criteria) return dim
    const criteria = dim.criteria.filter(c => {
      if (!c.applicable_when) return true
      const m = c.applicable_when.match(/^tag:([\w-]+)$/)
      if (!m) throw new Error(`applicable_when "${c.applicable_when}" is not tag-matched (tag:<name>)`)
      return tagSet.has(m[1])
    })
    return { ...dim, criteria }
  })
  return { ...rubric, dimensions }
}

/** Render the resolved rubric for the judge prompt. */
export function renderRubric(rubric: Rubric): string {
  const parts: string[] = []
  for (const dim of rubric.dimensions) {
    parts.push(`### ${dim.name} (style: ${dim.style}${dim.informational ? ', informational' : ''})`)
    if (dim.style === 'anchors' && dim.levels) {
      for (const level of [0, 1, 2, 3, 4]) parts.push(`- level ${level}: ${dim.levels[level]}`)
    } else if (dim.criteria) {
      for (const c of dim.criteria) parts.push(`- [${c.id}] ${c.text}`)
    }
    parts.push('')
  }
  return parts.join('\n')
}
