// Deterministic answer matchers for knowledge tasks. Judge-matched questions
// are handled in grade.ts (they need a model; these never do).

export interface KeyEntry {
  id: string
  match: 'regex' | 'containsAll' | 'judge'
  expected: string | string[]
  source: string
}

export interface MatcherOutcome {
  id: string
  match: KeyEntry['match']
  correct: boolean | null // null = judge-matched, resolved at grade time
  answer: string | null
}

export function scoreAnswers(
  answers: Record<string, unknown>,
  key: KeyEntry[]
): { outcomes: MatcherOutcome[]; deterministicCorrect: number; deterministicTotal: number } {
  const outcomes: MatcherOutcome[] = []
  let deterministicCorrect = 0
  let deterministicTotal = 0

  for (const entry of key) {
    const raw = answers[entry.id]
    const answer = typeof raw === 'string' ? raw : raw === undefined ? null : JSON.stringify(raw)
    if (entry.match === 'judge') {
      outcomes.push({ id: entry.id, match: 'judge', correct: null, answer })
      continue
    }
    deterministicTotal++
    let correct = false
    if (answer !== null) {
      if (entry.match === 'regex') {
        correct = new RegExp(entry.expected as string, 'i').test(answer)
      } else if (entry.match === 'containsAll') {
        correct = (entry.expected as string[]).every(s => answer.toLowerCase().includes(s.toLowerCase()))
      }
    }
    if (correct) deterministicCorrect++
    outcomes.push({ id: entry.id, match: entry.match, correct, answer })
  }

  return { outcomes, deterministicCorrect, deterministicTotal }
}
