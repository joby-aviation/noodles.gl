// The agent bench's tasks against the documents they start from: every node a check names
// exists, the setup applies, the task is not already done, and a reference fix passes every
// check and lowers. A task that drifts from its example fails here, not in a model run.

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type EditorDoc, lowerDocument } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type Check, grade } from '../../../bench/agent/grade'
import { parseTask, type Task } from '../../../bench/agent/tasks'
import { DocStore } from '../../editor/doc-store'
import { loadDoc } from '../../editor/load-doc'
import newProject from '../../noodles/new.json'
import { registerDeckOperators } from '../../runtime/deck-ops'
import { registerNoodlesRamps } from '../../runtime/ramps'
import { applyModifications, type DocModification } from '../doc-tools'
import type { BenchResult } from './bench-hook'
import { paramsOf, registryOf } from './snapshot'

beforeAll(() => {
  registerNoodlesRamps()
  registerDeckOperators()
})

const DIR = resolve('bench/agent/tasks')
const TASKS = readdirSync(DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => parseTask(readFileSync(resolve(DIR, f), 'utf8'), f))

// What a model that did the task right would send
const FIXES: Record<string, DocModification[]> = {
  't2-color-scheme': [{ type: 'update_node', id: '/magnitude-color', params: { ramp: 'magma' } }],
  't2-pickup-red': [{ type: 'update_node', id: '/pickup', params: { color: [255, 0, 0] } }],
  't2-point-radius': [
    { type: 'update_node', id: '/geojson-layer-points', params: { radiusScale: 10 } },
  ],
  't3-add-heatmap': [
    {
      type: 'add_node',
      op: 'heatmap',
      name: 'pickup_heatmap',
      params: { position: 'pickup_position' },
    },
    { type: 'add_edge', source: '/dropoff-position', target: 'pickup_heatmap', targetPort: 'in' },
    { type: 'add_edge', source: 'pickup_heatmap', target: '/deck', targetPort: 'layers' },
  ],
  't3-geojson-lines': [
    {
      type: 'add_node',
      op: 'geojson',
      name: 'bart',
      params: {
        url: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart.geo.json',
      },
    },
    {
      type: 'add_node',
      op: 'path',
      name: 'bart_lines',
      params: { position: '[lng, lat]', pathId: 'id', order: 'vertex' },
    },
    {
      type: 'add_edge',
      source: 'bart',
      sourcePort: 'lines',
      target: 'bart_lines',
      targetPort: 'in',
    },
    { type: 'add_edge', source: 'bart_lines', target: '/deck', targetPort: 'layers' },
  ],
  't3-scatterplot-from-url': [
    {
      type: 'add_node',
      op: 'file',
      name: 'stations',
      params: {
        url: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart-stations.json',
        format: 'json',
      },
    },
    {
      type: 'add_node',
      op: 'scatter',
      name: 'stations_layer',
      params: { position: 'coordinates' },
    },
    { type: 'add_edge', source: 'stations', target: 'stations_layer', targetPort: 'in' },
    { type: 'add_edge', source: 'stations_layer', target: '/deck', targetPort: 'layers' },
  ],
  't4-missing-data-edge': [
    { type: 'add_edge', source: '/dropoff-position', target: '/pickup-layer', targetPort: 'in' },
  ],
  't4-missing-layer-edge': [
    { type: 'add_edge', source: '/scatterplot-layer', target: '/deck', targetPort: 'layers' },
  ],
  't4-wrong-columns': [
    {
      type: 'update_node',
      id: '/position-accessor',
      params: { expression: '[Longitude, Latitude]' },
    },
  ],
}

// Checks about the task rather than the state of the graph
const MECHANICAL = new Set(['applySucceeded', 'noNewErrors', 'errorsFixed', 'noConsoleErrors'])

// The document the bench opens: an example, or a new project, loaded as the editor loads them
async function startDoc(task: Task): Promise<EditorDoc> {
  const json =
    task.start === 'blank'
      ? newProject
      : JSON.parse(readFileSync(resolve(`src/examples/${task.start}/noodles.json`), 'utf8'))
  return (await loadDoc(json)).doc
}

function apply(store: DocStore, modifications: DocModification[]) {
  return applyModifications({ store, engine: () => undefined }, { modifications })
}

// A run that ended with the store's document, its edits made with one successful tool call
function runOn(store: DocStore, edited: boolean): BenchResult {
  const doc = store.get().doc
  return {
    taskId: 't',
    provider: { id: 'anthropic', model: 'm', contextWindow: 1 },
    knobs: {},
    setupApply: null,
    turns: [
      {
        prompt: '',
        reply: '',
        steps: 1,
        toolCalls: edited
          ? [{ name: 'apply_modifications', params: {}, success: true, preview: '' }]
          : [],
        usage: { inputTokens: 0, outputTokens: 0 },
        diagnostics: [],
        stopReasons: ['end_turn'],
        modificationsCount: 0,
        apply: null,
        ms: 0,
        firstEventMs: 0,
      },
    ],
    initialDoc: null,
    finalDoc: doc,
    finalParams: paramsOf(doc),
    initialErrors: [],
    errors: [],
    registry: registryOf(),
    loadMs: 0,
    timedOut: false,
  }
}

// Every node path a check names
function namedNodes(checks: Check[]): string[] {
  return checks.flatMap(c => {
    if (c.type === 'anyOf') return namedNodes(c.checks)
    const named = c as { node?: string; source?: string; target?: string }
    return [named.node, named.source, named.target].filter((n): n is string => !!n)
  })
}

describe.each(TASKS.map(t => [t.id, t] as const))('%s', (_, task) => {
  const setUp = async () => {
    const store = new DocStore(await startDoc(task))
    if (task.setup.modifications.length) {
      expect(apply(store, task.setup.modifications).error).toBeUndefined()
    }
    return store
  }

  it('names only nodes the start document has', async () => {
    const run = runOn(await setUp(), false)
    const missing = namedNodes(task.grader.checks).filter(
      n =>
        grade([{ type: 'paramEquals', node: n, param: '_', value: 0 }], { result: run }).checks[0]
          .detail === 'no matching node'
    )
    expect(missing).toEqual([])
  })

  if (task.tier === 'T1') {
    it('passes its project checks before the agent answers', async () => {
      const projectChecks = task.grader.checks.filter(c => c.type === 'nodeCount')
      expect(grade(projectChecks, { result: runOn(await setUp(), false) }).pass).toBe(true)
    })
    return
  }

  it('is not done before the agent starts', async () => {
    const taskChecks = task.grader.checks.filter(c => !MECHANICAL.has(c.type))
    expect(grade(taskChecks, { result: runOn(await setUp(), false) }).pass).toBe(false)
  })

  it('passes every check with the reference fix, which lowers', async () => {
    const store = await setUp()
    const fix = FIXES[task.id]
    expect(fix, 'add a reference fix to FIXES').toBeDefined()
    expect(apply(store, fix).error).toBeUndefined()
    const graded = grade(task.grader.checks, { result: runOn(store, true) })
    expect(graded.checks.filter(c => !c.pass).map(c => `${c.check.type}: ${c.detail}`)).toEqual([])
    expect(lowerDocument(store.get().doc).errors).toEqual([])
  })
})
