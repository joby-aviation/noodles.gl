import { describe, expect, it } from 'vitest'
import {
  CastOp,
  FileOp,
  GroupByOp,
  JoinOp,
  StringTransformOp,
  WindowOp,
} from '../operators'

describe('Bug Fixes', () => {
  describe('StringTransformOp invalid regex handling', () => {
    it('handles invalid regex pattern in regex_extract gracefully', () => {
      const op = new StringTransformOp('/str')
      const result = op.execute({
        data: [
          { text: 'hello world' },
          { text: 'foo bar' },
        ],
        column: 'text',
        operation: 'regex_extract',
        pattern: '[',
        replacement: '',
        outputColumn: 'result',
      } as any)

      expect(result.data).toEqual([
        { text: 'hello world', result: null },
        { text: 'foo bar', result: null },
      ])
    })

    it('handles invalid regex pattern in regex_replace gracefully', () => {
      const op = new StringTransformOp('/str')
      const result = op.execute({
        data: [
          { text: 'hello world' },
          { text: 'foo bar' },
        ],
        column: 'text',
        operation: 'regex_replace',
        pattern: '(?<',
        replacement: 'X',
        outputColumn: 'result',
      } as any)

      expect(result.data).toEqual([
        { text: 'hello world', result: 'hello world' },
        { text: 'foo bar', result: 'foo bar' },
      ])
    })
  })

  describe('WindowOp rank vs dense_rank', () => {
    it('computes rank correctly with ties', () => {
      const op = new WindowOp('/window')
      const result = op.execute({
        data: [
          { name: 'Alice', score: 100 },
          { name: 'Bob', score: 90 },
          { name: 'Charlie', score: 90 },
          { name: 'David', score: 80 },
        ],
        column: '',
        function: 'rank',
        partitionBy: '',
        orderBy: 'score',
        order: 'desc',
        windowSize: 0,
        outputColumn: 'rank',
      } as any)

      expect(result.data.map(r => r.rank)).toEqual([1, 2, 2, 4])
    })

    it('computes dense_rank correctly with ties', () => {
      const op = new WindowOp('/window')
      const result = op.execute({
        data: [
          { name: 'Alice', score: 100 },
          { name: 'Bob', score: 90 },
          { name: 'Charlie', score: 90 },
          { name: 'David', score: 80 },
        ],
        column: '',
        function: 'dense_rank',
        partitionBy: '',
        orderBy: 'score',
        order: 'desc',
        windowSize: 0,
        outputColumn: 'dense_rank',
      } as any)

      expect(result.data.map(r => r.dense_rank)).toEqual([1, 2, 2, 3])
    })

    it('rank and dense_rank produce different results', () => {
      const data = [
        { name: 'A', score: 100 },
        { name: 'B', score: 90 },
        { name: 'C', score: 90 },
        { name: 'D', score: 90 },
        { name: 'E', score: 80 },
      ]

      const rankOp = new WindowOp('/rank')
      const rankResult = rankOp.execute({
        data,
        column: '',
        function: 'rank',
        partitionBy: '',
        orderBy: 'score',
        order: 'desc',
        windowSize: 0,
        outputColumn: 'result',
      } as any)

      const denseOp = new WindowOp('/dense')
      const denseResult = denseOp.execute({
        data,
        column: '',
        function: 'dense_rank',
        partitionBy: '',
        orderBy: 'score',
        order: 'desc',
        windowSize: 0,
        outputColumn: 'result',
      } as any)

      expect(rankResult.data.map(r => r.result)).toEqual([1, 2, 2, 2, 5])
      expect(denseResult.data.map(r => r.result)).toEqual([1, 2, 2, 2, 3])
    })
  })

  describe('JoinOp column collision handling', () => {
    it('suffixes overlapping right columns with _right', () => {
      const op = new JoinOp('/join')
      const result = op.execute({
        left: [
          { id: 1, name: 'Alice', value: 100 },
          { id: 2, name: 'Bob', value: 200 },
        ],
        right: [
          { id: 1, name: 'Product A', value: 50 },
          { id: 2, name: 'Product B', value: 75 },
        ],
        leftKey: 'id',
        rightKey: 'id',
        joinType: 'inner',
      } as any)

      expect(result.data).toEqual([
        { id: 1, name: 'Alice', value: 100, name_right: 'Product A', value_right: 50 },
        { id: 2, name: 'Bob', value: 200, name_right: 'Product B', value_right: 75 },
      ])
    })

    it('does not suffix join key column', () => {
      const op = new JoinOp('/join')
      const result = op.execute({
        left: [
          { id: 1, category: 'A' },
        ],
        right: [
          { id: 1, category: 'B' },
        ],
        leftKey: 'id',
        rightKey: 'id',
        joinType: 'inner',
      } as any)

      expect(result.data[0].id).toBe(1)
      expect(result.data[0].category).toBe('A')
      expect(result.data[0].category_right).toBe('B')
    })
  })

  describe('CastOp invalid date handling', () => {
    it('returns null for unparseable date strings', () => {
      const op = new CastOp('/cast')
      const result = op.execute({
        data: [
          { date: 'not-a-date' },
          { date: 'invalid' },
          { date: '2024-01-15' },
        ],
        column: 'date',
        targetType: 'DATE',
        outputColumn: 'parsed',
      } as any)

      expect(result.data[0].parsed).toBeNull()
      expect(result.data[1].parsed).toBeNull()
      expect(result.data[2].parsed).toContain('2024-01-15')
    })

    it('returns null for unparseable timestamp strings', () => {
      const op = new CastOp('/cast')
      const result = op.execute({
        data: [
          { ts: 'abc123' },
          { ts: '' },
        ],
        column: 'ts',
        targetType: 'TIMESTAMP',
        outputColumn: 'parsed',
      } as any)

      expect(result.data[0].parsed).toBeNull()
      expect(result.data[1].parsed).toBeNull()
    })
  })

  describe('GroupByOp column validation', () => {
    it('throws error for non-existent group by column', () => {
      const op = new GroupByOp('/group')
      expect(() =>
        op.execute({
          data: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
          ],
          groupByColumns: 'nonexistent_column',
          aggregations: 'COUNT(*) as count',
        } as any)
      ).toThrow("GroupBy column 'nonexistent_column' does not exist in data")
    })

    it('throws error for multiple non-existent columns', () => {
      const op = new GroupByOp('/group')
      expect(() =>
        op.execute({
          data: [{ name: 'Alice', age: 30 }],
          groupByColumns: 'category,department',
          aggregations: 'COUNT(*) as count',
        } as any)
      ).toThrow("GroupBy column 'category' does not exist in data")
    })
  })
})
