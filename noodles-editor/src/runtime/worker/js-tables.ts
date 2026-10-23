// JS tables: a code node's rows, made by running its code on its input's rows and loaded into
// DuckDB under the table the planner named for it. Run once per code and input, since the
// name hashes both: an unchanged node is never run again.

import type { RelationPlan } from '@noodles.gl/planner'
import { tableFromJSON, tableToIPC } from 'apache-arrow'
import { flatRow, isFeatureCollection, readPlainRows } from '../plain-rows'
import { tableFromRows } from './arrow-rows'
import type { BlockingSql } from './blocking-sql'
import { featuresTable, geometryFromWkb } from './geojson-wkb'
import { compileWithScope } from './js-scope'

export class JsTables {
  private readonly made = new Set<string>()

  constructor(private readonly sql: BlockingSql) {}

  async make(rel: RelationPlan): Promise<void> {
    const js = rel.js
    if (!js || this.made.has(js.table)) return
    let d: unknown = []
    if (js.input) {
      d = await this.readInput(js.input)
    } else if (js.url) {
      // A JSON file read whole, as CodeOp's input from a JSON FileOp was the parsed file.
      // A registered file is read as registered: read_text cannot read one named by a URL
      const registered = this.sql.readFile(js.url)
      let text: string
      if (registered === undefined) {
        const [file] = await this.sql.rows(
          `SELECT content FROM read_text('${js.url.replace(/'/g, "''")}')`
        )
        text = String(file?.content ?? 'null')
      } else {
        text = typeof registered === 'string' ? registered : new TextDecoder().decode(registered)
      }
      d = JSON.parse(text)
    }
    let result: unknown
    try {
      // `data` is every input, as CodeOp passed them; a code node has one
      result = await compileWithScope(['d', 'data'], js.code, { async: true })(d, [d])
    } catch (error) {
      throw new Error(`Code: ${error instanceof Error ? error.message : String(error)}`)
    }
    const table = `"${js.table}"`
    if (isFeatureCollection(result) && result.features.length === 0) {
      await this.sql.exec(
        `CREATE OR REPLACE TEMP TABLE ${table} AS SELECT NULL::GEOMETRY AS geom WHERE false`
      )
    } else if (isFeatureCollection(result)) {
      await this.loadFeatures(js.table, result.features)
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

  // An input with a geometry column is features, so `d` is a FeatureCollection turf can take;
  // any other input is its rows as plain objects
  private async readInput(relation: string): Promise<unknown> {
    const columns = await this.sql.rows(`DESCRIBE SELECT * FROM ${relation}`)
    const geom = columns.find(c => c.column_name === 'geom' && c.column_type === 'GEOMETRY')
    if (!geom) return readPlainRows(this.sql, relation)
    // As WKB, read in JS: ST_AsGeoJSON drops m (world-flights' timestamps), and parsing a JSON
    // text per feature is slower
    const rows = await readPlainRows(
      this.sql,
      `(SELECT * EXCLUDE (geom), ST_AsWKB(geom) AS "__wkb" FROM ${relation})`
    )
    return {
      type: 'FeatureCollection',
      features: rows.map(({ __wkb, ...properties }) => ({
        type: 'Feature',
        geometry: __wkb instanceof Uint8Array ? geometryFromWkb(__wkb) : null,
        properties,
      })),
    }
  }

  /**
   * GeoJSON features into a table, one row per feature with its properties and a `geom`, as
   * ST_Read reads a file: as Arrow with the geometries as WKB (featuresTable), else through
   * ST_Read when a property or geometry is one Arrow or WKB cannot hold.
   */
  private async loadFeatures(name: string, features: unknown[]): Promise<void> {
    const staged = `${name}__wkb`
    try {
      const table = featuresTable(features as never)
      if (table) {
        this.sql.insertArrow(staged, tableToIPC(table, 'stream'))
        await this.sql.exec(
          `CREATE OR REPLACE TEMP TABLE "${name}" AS ` +
            `SELECT * EXCLUDE (__wkb), ST_GeomFromWKB(__wkb) AS geom FROM "${staged}"`
        )
        await this.sql.exec(`DROP TABLE IF EXISTS "${staged}"`)
        return
      }
    } catch {
      await this.sql.exec(`DROP TABLE IF EXISTS "${staged}"`)
    }
    const file = `${name}.geojson`
    this.sql.registerText(file, JSON.stringify({ type: 'FeatureCollection', features }))
    await this.sql.exec(
      `CREATE OR REPLACE TEMP TABLE "${name}" AS SELECT * FROM ST_Read('${file}')`
    )
  }

  /**
   * Rows into a table: as Arrow built column by column into typed arrays when every column is
   * one plain shape (tableFromRows: world-flights' 1.5M path vertices in a fifth of the time),
   * else as Arrow from tableFromJSON, else as JSON when Arrow cannot type a column (mixed values).
   */
  private async load(name: string, rows: Record<string, unknown>[]): Promise<void> {
    try {
      const table = tableFromRows(rows) ?? tableFromJSON(rows)
      this.sql.insertArrow(name, tableToIPC(table, 'stream'))
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
