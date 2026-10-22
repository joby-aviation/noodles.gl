/**
 * The database seam.
 *
 * The library needs two things from a data layer and nothing more: the ability to run SQL
 * and get Arrow back, and a way for a relation to come into existence. Naming those as
 * interfaces is what removes `@duckdb/duckdb-wasm` from the library's dependencies
 * entirely — the adapter lives behind `./duckdb`, and a consumer with their own connection,
 * their own parquet endpoint, or a MotherDuck/DuckDB-node setup can supply their own.
 *
 * It also removes the demo's synthetic generator from the runtime, which used to be
 * imported directly and made "9 clustered columns" part of the library's surface.
 */

import type { Table } from 'apache-arrow';

export interface QueryTiming {
  /** Milliseconds inside the engine, wall clock from the caller's side. */
  ms: number;
  rows: number;
}

/**
 * What the planner and runtime require of a SQL engine.
 *
 * `run` must bind numbered `$1`-style placeholders from `binds` in order, because that is how
 * a value parameter is rebound without re-planning — see `backends/sql.ts`. An implementation
 * that ignores `binds` will silently break the cheap-reparameterization path.
 */
export interface SqlEngine {
  /** Fire-and-forget DDL. */
  exec(sql: string): Promise<void>;
  /** Run a statement, preparing and caching it when it has parameters. Returns Arrow. */
  run(sql: string, binds?: (number | string)[]): Promise<{ table: Table; timing: QueryTiming }>;
  /** Column name -> engine type name, for a relation. */
  describe(relation: string): Promise<Map<string, string>>;
  /** Drop cached prepared statements, e.g. after DDL that invalidates them. */
  resetPrepared(): Promise<void>;
  /**
   * Drop the prepared statement for one SQL text, if cached. Optional so existing engines
   * still conform; a caller that generates many distinct statements (one per memoized
   * relation) needs it, or the cache grows without bound and holds statements over
   * dropped tables.
   */
  release?(sql: string): Promise<void>;
}

/**
 * How a source relation is produced.
 *
 * `materialize` runs before planning. It may create a table, register a view over a remote
 * file, or do nothing at all if the relation already exists.
 */
export interface SourceProvider {
  /** Relation name the generated SQL will query. Quoted if it needs to be. */
  readonly relation: string;
  /** A short description for the inspector. */
  readonly describe?: string;
  materialize(sql: SqlEngine): Promise<void>;
}

/** The relation is already in the database; nothing to do. */
export function relationSource(relation: string): SourceProvider {
  return {
    relation: quoteRelation(relation),
    describe: `existing relation ${relation}`,
    async materialize() {},
  };
}

/**
 * A view over a file DuckDB can read directly.
 *
 * Worth knowing what this buys: for parquet, DuckDB does projection pushdown and row-group
 * pruning itself, so the columns this library's projection pushdown drops are never fetched
 * over the network in the first place. That optimization happens one layer below the
 * planner, for free.
 */
export function parquetUrlSource(url: string, as = 'src'): SourceProvider {
  return {
    relation: quoteRelation(as),
    describe: url,
    async materialize(sql) {
      await sql.resetPrepared();
      await sql.exec(
        `CREATE OR REPLACE VIEW ${quoteRelation(as)} AS SELECT * FROM '${escapeLiteral(url)}'`,
      );
    },
  };
}

/** A provider from a literal SQL statement that creates the relation. */
export function sqlSource(ddl: string, as = 'src'): SourceProvider {
  return {
    relation: quoteRelation(as),
    describe: 'custom SQL',
    async materialize(sql) {
      await sql.resetPrepared();
      await sql.exec(ddl);
    },
  };
}

/** Registry mapping a graph's `source.dataset.ref` to a provider. */
export class SourceRegistry {
  private providers = new Map<string, SourceProvider>();

  register(ref: string, provider: SourceProvider): this {
    this.providers.set(ref, provider);
    return this;
  }

  resolve(ref: string): SourceProvider {
    const provider = this.providers.get(ref);
    if (!provider) {
      throw new Error(
        `No source registered for ref '${ref}'. Registered: ${[...this.providers.keys()].join(', ') || '(none)'}`,
      );
    }
    return provider;
  }

  has(ref: string): boolean {
    return this.providers.has(ref);
  }
}

export function quoteRelation(name: string): string {
  // Already-quoted names pass through, so callers can supply `"my schema"."t"`.
  return name.startsWith('"') ? name : `"${name.replace(/"/g, '""')}"`;
}

export function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
