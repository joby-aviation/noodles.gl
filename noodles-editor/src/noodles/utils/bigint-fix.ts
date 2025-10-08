// For dealing with DuckDB and the ViewerOp (serializing to JSON)
;(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString()
}
