// Helpers for building DuckDB SQL from user-supplied values. DuckDB-WASM has no
// parameter binding for table functions like read_parquet(), so string values have
// to be quoted by hand. Both helpers follow the SQL standard: double the quote
// character to escape it.

// Quote a value as a string literal: O'Hare -> 'O''Hare'
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// Quote a column or table name as a delimited identifier: geo"m -> "geo""m"
export function sqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
