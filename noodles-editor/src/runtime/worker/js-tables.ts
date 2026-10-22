// JS tables: a code node's rows, made by running its code on its input's rows and loaded into
// DuckDB under the table the planner named for it. Run once per code and input, since the
// name hashes both: an unchanged node is never run again.

import type { RelationPlan } from '@noodles.gl/planner'
import { tableFromJSON, tableToIPC } from 'apache-arrow'
import { flatRow, isFeatureCollection, readPlainRows } from '../plain-rows'
import type { BlockingSql } from './blocking-sql'
import { compileWithScope } from './js-scope'

export class JsTables {
  private readonly made = new Set<string>()

  constructor(private readonly sql: BlockingSql) {}

  async make(rel: RelationPlan): Promise<void> {
    const js = rel.js
    if (!js || this.made.has(js.table)) return
    let d: unknown = []
    if (js.input) {
      d = await readPlainRows(this.sql, js.input)
    } else if (js.url) {
      // A JSON file read whole, as CodeOp's input from a JSON FileOp was the parsed file
      const [file] = await this.sql.rows(
        `SELECT content FROM read_text('${js.url.replace(/'/g, "''")}')`
      )
      d = JSON.parse(String(file?.content ?? 'null'))
    }
    let result: unknown
    try {
      // `data` is every input, as CodeOp passed them; a code node has one
      result = await compileWithScope(['d', 'data'], js.code)(d, [d])
    } catch (error) {
      throw new Error(`Code: ${error instanceof Error ? error.message : String(error)}`)
    }
    const table = `"${js.table}"`
    if (isFeatureCollection(result)) {
      // GeoJSON: one row per feature with its geometry, as a geojson node reads them
      const file = `${js.table}.geojson`
      this.sql.registerText(file, JSON.stringify(result))
      await this.sql.exec(
        `CREATE OR REPLACE TEMP TABLE ${table} AS SELECT * FROM ST_Read('${file}')`
      )
    } else if (Array.isArray(result)) {
      if (result.length === 0) {
        await this.sql.exec(
          `CREATE OR REPLACE TEMP TABLE ${table} AS SELECT NULL AS value WHERE false`
        )
      } else {
        await this.load(js.table, result.map(flatRow) as Record<string, unknown>[])
      }
    } else {
      throw new Error('Code must return an array of rows or a GeoJSON FeatureCollection')
    }
    this.made.add(js.table)
  }

  /**
   * Rows into a table: as Arrow, three times faster than JSON for a large table (world-flights'
   * 1.5M vertices: 6 s against 18 s), or as JSON when Arrow cannot type a column (mixed values).
   */
  private async load(name: string, rows: Record<string, unknown>[]): Promise<void> {
    try {
      this.sql.insertArrow(name, tableToIPC(tableFromJSON(rows), 'stream'))
      return
    } catch {
      await this.sql.exec(`DROP TABLE IF EXISTS "${name}"`)
    }
    const file = `${name}.json`
    this.sql.registerText(file, JSON.stringify(rows))
    await this.sql.exec(
      `CREATE OR REPLACE TEMP TABLE "${name}" AS SELECT * FROM read_json_auto('${file}')`
    )
  }
}
