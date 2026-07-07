// Assemble a small, readable evidence pack for presentations: one FAILED run
// (frozen mechanical facts, judge scores with citations, the transcript moment)
// and one PASSING run (final artifact + screenshot), plus the task file, a
// rubric excerpt, and the two D6 series rows. Excerpts name their source path;
// verbatim copies are bit-identical.
//
//   npm run evidence-pack -- --series <series> --fail <runId> --pass <runId> \
//     [--out /tmp/eval-evidence] [--lines 672-700] \
//     [--judge-dims correctness_of_result,tool_use_discipline,honesty] \
//     [--rubric-dims tool_use_discipline,edit_hygiene]

import * as fs from 'node:fs'
import * as path from 'node:path'
import { readIndex } from './grade'
import { RESULTS_ROOT, RUBRICS_ROOT, TASKS_ROOT } from './lib/config'
import { loadTask } from './lib/task'

const MAX_EXCERPT_LINE = 400

interface Options {
  series: string
  failRunId: string
  passRunId: string
  outDir: string
  lines?: [number, number]
  judgeDims: string[]
  rubricDims: string[]
}

export function buildEvidencePack(opts: Options): string[] {
  const runDir = (runId: string) => path.join(RESULTS_ROOT, opts.series, 'runs', runId)
  const failDir = runDir(opts.failRunId)
  const passDir = runDir(opts.passRunId)
  const failMeta = JSON.parse(fs.readFileSync(path.join(failDir, 'session-meta.json'), 'utf-8'))
  const task = loadTask(String(failMeta.taskId))
  fs.mkdirSync(opts.outDir, { recursive: true })
  const written: string[] = []
  const emit = (name: string, content: string | Buffer) => {
    fs.writeFileSync(path.join(opts.outDir, name), content)
    written.push(name)
  }

  // 1. task file, verbatim
  emit(`${task.id}.task.md`, fs.readFileSync(path.join(TASKS_ROOT, `${task.id}.md`)))

  // 2. rubric excerpt: the requested dimensions, verbatim blocks
  const rubricFile = task.grader.rubric
  const rubricRaw = fs.readFileSync(path.join(RUBRICS_ROOT, rubricFile), 'utf-8')
  const blocks = opts.rubricDims.map(dim => {
    const match = rubricRaw.match(new RegExp(`^  ${dim}:\\n(?:^(?:    .*|)\\n?)*`, 'm'))
    if (!match) throw new Error(`dimension "${dim}" not found in ${rubricFile}`)
    return match[0].trimEnd()
  })
  emit(
    'rubric-excerpt.yaml',
    `# Excerpt from evals/rubrics/${rubricFile} (verbatim blocks: ${opts.rubricDims.join(', ')}).\n# Full rubric in the repo.\n\n${blocks.join('\n\n')}\n`
  )

  // 3a. failed run mechanical.json, verbatim
  emit('failed-run.mechanical.json', fs.readFileSync(path.join(failDir, 'mechanical.json')))

  // 3b. judge excerpt with citations
  const scores = JSON.parse(fs.readFileSync(path.join(failDir, 'scores.json'), 'utf-8'))
  const sample = scores.judge.samples[0].dimensions as Record<string, unknown>
  emit(
    'failed-run.judge-excerpt.json',
    `${JSON.stringify(
      {
        _source: `evals/results/${opts.series}/runs/${opts.failRunId}/scores.json (judge sample 1 of ${scores.judge.samples.length}; medians across all samples)`,
        row_scores: scores.row.scores,
        perDimensionMedians: Object.fromEntries(
          Object.entries(scores.judge.perDimension as Record<string, { median: number }>).map(([k, v]) => [k, v.median])
        ),
        sample1_excerpt: Object.fromEntries(opts.judgeDims.map(d => [d, sample[d]])),
      },
      null,
      2
    )}\n`
  )

  // 3c. transcript excerpt (requested range, or auto: around the last Write of the artifact)
  const transcript = fs.readFileSync(path.join(failDir, 'transcript.txt'), 'utf-8').split('\n')
  let [from, to] = opts.lines ?? [0, 0]
  if (!opts.lines) {
    const artifactBase = path.basename(task.grader.artifact)
    let writeLine = -1
    transcript.forEach((line, i) => {
      if (line.includes('[tool_use Write]') && line.includes(artifactBase)) writeLine = i + 1
    })
    if (writeLine < 0) throw new Error(`no Write of ${artifactBase} found; pass --lines A-B explicitly`)
    from = Math.max(1, writeLine - 15)
    to = Math.min(transcript.length, writeLine + 14)
  }
  const excerpt = transcript
    .slice(from - 1, to)
    .map(l => (l.length > MAX_EXCERPT_LINE ? `${l.slice(0, MAX_EXCERPT_LINE)} […truncated]` : l))
  emit(
    'transcript-excerpt.txt',
    `# Source: evals/results/${opts.series}/runs/${opts.failRunId}/transcript.txt, lines ${from}-${to} (of ${transcript.length}).\n# Long lines truncated at ${MAX_EXCERPT_LINE} chars, marked […truncated].\n\n${excerpt.join('\n')}\n`
  )

  // 4. passing run artifact + screenshot, verbatim
  emit('passing-run.noodles.json', fs.readFileSync(path.join(passDir, 'artifacts', path.basename(task.grader.artifact))))
  const shot = path.join(passDir, 'screenshot.png')
  if (fs.existsSync(shot)) emit('passing-run.screenshot.png', fs.readFileSync(shot))

  // 5. index rows for the two runs (latest grading each)
  const index = readIndex()
  const latestRow = (runId: string) =>
    index.rows
      .filter(r => r.series === opts.series && r.runId === runId)
      .sort((a, b) => (a.gradedAt < b.gradedAt ? 1 : -1))[0]
  emit(
    'index-rows.json',
    `${JSON.stringify(
      { _source: 'evals/results/index.json (latest grading row per run)', rows: [latestRow(opts.failRunId), latestRow(opts.passRunId)] },
      null,
      2
    )}\n`
  )

  emit(
    'README.md',
    `# Evidence pack — ${task.id} (series ${opts.series})

Generated by \`npm run evidence-pack -- --series ${opts.series} --fail ${opts.failRunId} --pass ${opts.passRunId}${opts.lines ? ` --lines ${opts.lines[0]}-${opts.lines[1]}` : ''}\`
(evals/harness/evidence-pack.ts). Verbatim copies are bit-identical to the repo;
excerpts name their source in their first line/key.

- failed run: ${opts.failRunId}
- passing run: ${opts.passRunId}
- files: ${written.join(', ')}
`
  )
  return written
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const series = get('series')
  const failRunId = get('fail')
  const passRunId = get('pass')
  if (!series || !failRunId || !passRunId) throw new Error('missing --series/--fail/--pass')
  const linesArg = get('lines')
  const files = buildEvidencePack({
    series,
    failRunId,
    passRunId,
    outDir: get('out', '/tmp/eval-evidence') as string,
    lines: linesArg ? (linesArg.split('-').map(Number) as [number, number]) : undefined,
    judgeDims: (get('judge-dims', 'correctness_of_result,tool_use_discipline,honesty') as string).split(','),
    rubricDims: (get('rubric-dims', 'tool_use_discipline,edit_hygiene') as string).split(','),
  })
  console.log(`${files.length} files → ${get('out', '/tmp/eval-evidence')}`)
}
