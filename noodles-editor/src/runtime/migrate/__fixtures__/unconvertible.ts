/**
 * Examples whose operator graph has JS no conversion can express, written as documents by hand:
 * flight-tracks parsed WKT text in JS accessors, which is ST_GeomFromText in SQL.
 */
export const UNCONVERTIBLE: Record<string, RegExp> = {
  'flight-tracks': /getPath must read a list column/,
}
