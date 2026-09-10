// Score assembly (07 D4/D6): mechanical results are frozen facts from run
// time; judge samples reduce to a median per dimension; a mechanical failure
// caps the total at 40% regardless of judge opinion. The D6 row schema plus
// the phase-0 amendments (sessionModel, provider, region).

import type { JudgeSample } from './judge'
import type { Rubric } from './rubric'

export const MECHANICAL_FAILURE_CAP = 0.4 * 4 // 40% of the 0-4 scale

export interface MechanicalResults {
  validatorVersion: string
  pass: boolean
  checks: Record<string, { pass: boolean; detail?: string }>
  /** knowledge tasks: deterministic matcher tallies (frozen) */
  answersDeterministic?: { correct: number; total: number }
  score0to4: number
}

export function dimensionScore(sample: JudgeSample, rubric: Rubric, name: string): number {
  const dim = rubric.dimensions.find(d => d.name === name)
  if (!dim) throw new Error(`unknown dimension ${name}`)
  const judged = sample.dimensions[name]
  if (dim.style === 'anchors') return judged.level ?? 0
  const verdicts = Object.values(judged.criteria ?? {})
  const applicable = verdicts.filter(v => v.verdict !== 'na')
  if (applicable.length === 0) return Number.NaN // fully N/A: excluded from weighting
  return (4 * applicable.filter(v => v.verdict === 'pass').length) / applicable.length
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface JudgeScore {
  perDimension: Record<string, { samples: number[]; median: number }>
  weighted0to4: number
}

export function reduceJudgeSamples(samples: JudgeSample[], rubric: Rubric): JudgeScore {
  const perDimension: JudgeScore['perDimension'] = {}
  let weightedSum = 0
  let weightTotal = 0
  for (const dim of rubric.dimensions) {
    const scores = samples.map(s => dimensionScore(s, rubric, dim.name)).filter(v => !Number.isNaN(v))
    const med = scores.length > 0 ? median(scores) : Number.NaN
    perDimension[dim.name] = { samples: scores, median: med }
    if (!dim.informational && dim.weight > 0 && !Number.isNaN(med)) {
      weightedSum += dim.weight * med
      weightTotal += dim.weight
    }
  }
  return { perDimension, weighted0to4: weightTotal > 0 ? weightedSum / weightTotal : 0 }
}

/** Total on the 0-4 scale: equal blend of mechanical and judge components,
 * then the Layer-1 cap — a beautiful transcript that produced an invalid file
 * is a failure with good manners (07 D4). */
export function totalScore(mechanical: MechanicalResults, judge0to4: number): number {
  const blended = 0.5 * mechanical.score0to4 + 0.5 * judge0to4
  return mechanical.pass ? blended : Math.min(blended, MECHANICAL_FAILURE_CAP)
}

// D6 series row (+ phase-0 amendments: sessionModel/provider/region,
// isolationAudit). validatorVersion is copied from the run's frozen
// mechanical results — it never changes on regrade.
export interface SeriesRow {
  runId: string
  artifactsRef: string
  commit: string
  tier: string
  taskId: string
  taskVersion: number
  validatorVersion: string
  kind: 'fresh' | 'regrade'
  regradeOf?: string
  gradedAt: string
  rubricVersion: number
  judgeModel: string
  sessionModel: string
  provider: string
  region: string
  isolationAudit: 'pass' | 'fail'
  scores: {
    mechanical: number
    judge: number
    total: number
    process: Record<string, unknown>
  }
  cost: { sessionUsd: number | null; judgeUsd: number | null }
  lane: 'milestone' | 'smoke'
}
