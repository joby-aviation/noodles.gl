// All possible combinations of pairs in an array
// cross([1,2,3]) => [[1, 2], [1, 3], [2, 3]]
export const cross = <T>(arr: T[]): [T, T][] =>
  arr.flatMap((a, i) => arr.slice(i + 1).map(b => [a, b] as [T, T]))
