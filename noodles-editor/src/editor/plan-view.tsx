// What the graph compiled to, for people working on Noodles (debug mode only): every relation
// with its memo key and SQL, every layer with its query, each parameter's routes, and the
// counters that say what changes have cost. The equivalent of duckdb-deck-demo's Plan tab.

import { useEngineState } from './doc-engine'
import { useEditor } from './doc-store'
import s from './plan-view.module.css'

export function PlanView() {
  const { program, layers, counters } = useEngineState()
  const debug = useEditor(st => st.debug ?? false)
  // Planner internals only for people working on Noodles, even in an area left open
  if (!debug) {
    return <div className={s.plan}>Turn on Show editor debug info to see the plan.</div>
  }
  if (!program) return <div className={s.plan}>Not compiled yet.</div>
  return (
    <div className={s.plan}>
      <section className={s.card}>
        <h5>Runtime</h5>
        <div className={s.counters}>
          <span>
            compiles <b>{counters?.compiles ?? 0}</b>
          </span>
          <span>
            layer queries <b>{counters?.requeries ?? 0}</b>
          </span>
          <span>
            cpu passes <b>{counters?.evaluations ?? 0}</b>
          </span>
          <span>
            prop-only updates <b>{counters?.propUpdates ?? 0}</b>
          </span>
        </div>
        {program.errors.length > 0 && (
          <pre className={s.errors}>
            {program.errors.map(e => `${e.nodeId}: ${e.message}`).join('\n')}
          </pre>
        )}
      </section>
      {program.relations.map(r => (
        <section className={s.card} key={r.id}>
          <h5>
            {r.id}{' '}
            <span className={s.kind}>
              {r.kind} · {r.materialize ? 'materialized' : 'inlined'}
            </span>
          </h5>
          <dl className={s.kv}>
            <dt>hash</dt>
            <dd>{r.hash}</dd>
            <dt>rows</dt>
            <dd>{r.rows?.toLocaleString() ?? '—'}</dd>
            <dt>reads</dt>
            <dd>{r.inputs.join(', ') || '—'}</dd>
            <dt>read by</dt>
            <dd>{r.consumers.join(', ') || '—'}</dd>
            {r.params.length > 0 && (
              <>
                <dt>inlines</dt>
                <dd>{r.params.join(', ')}</dd>
              </>
            )}
          </dl>
          <pre className={s.code}>{r.sql}</pre>
        </section>
      ))}
      {layers.map(l => (
        <section className={s.card} key={l.id}>
          <h5>
            {l.id}{' '}
            <span className={s.kind}>
              {l.kind} layer · {l.rows.toLocaleString()} rows · query {l.queryMs.toFixed(1)} ms
            </span>
          </h5>
          {l.sql && <pre className={s.code}>{l.sql}</pre>}
        </section>
      ))}
      <section className={s.card}>
        <h5>Parameter routes</h5>
        <dl className={s.kv}>
          {Object.entries(program.routes).map(([p, routes]) => [
            <dt key={`${p}:name`}>{p}</dt>,
            <dd key={`${p}:routes`}>{routes.map(r => `${r.route} → ${r.target}`).join(' · ')}</dd>,
          ])}
        </dl>
      </section>
    </div>
  )
}
