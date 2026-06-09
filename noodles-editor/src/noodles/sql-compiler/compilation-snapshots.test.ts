import { describe, expect, it } from 'vitest'
import { FileOp, FilterOp, GroupByOp, JoinOp, SliceOp, SortOp, UniqueOp, WindowOp } from '../operators'
import type { CompilableNode } from './compiler'
import { compile } from './compiler'
import { adaptOperator } from './subgraph-detector'

// Snapshot tests for SQL compilation
// These validate that graph→SQL compilation produces expected SQL strings
// and catch any unintended changes to SQL generation logic.

describe('SQL Compilation Snapshots', () => {
  describe('Single operator compilation', () => {
    it('FileOp: CSV', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('test.csv')
      fileOp.inputs.format.setValue('csv')

      const adapted = adaptOperator(fileOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH data AS (
        /* operator: /data */
        /* type: File */
        SELECT * FROM read_csv_auto($1, header=true, auto_detect=true)
        ) SELECT * FROM data"
      `)
      expect(compiled.paramSlots).toMatchInlineSnapshot(`
        [
          {
            "fieldPath": "/data.url",
            "index": 1,
            "type": "string",
          },
        ]
      `)
    })

    it('FileOp: JSON', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('data.json')
      fileOp.inputs.format.setValue('json')

      const adapted = adaptOperator(fileOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH data AS (
        /* operator: /data */
        /* type: File */
        SELECT * FROM read_json_auto($1)
        ) SELECT * FROM data"
      `)
    })

    it('FileOp: Parquet', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('data.parquet')
      fileOp.inputs.format.setValue('parquet')

      const adapted = adaptOperator(fileOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH data AS (
        /* operator: /data */
        /* type: File */
        SELECT * FROM read_json_auto($1)
        ) SELECT * FROM data"
      `)
    })

    it('FilterOp: equals', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('status')
      filterOp.inputs.condition.setValue('equals')
      filterOp.inputs.value.setValue('active')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "status" = $1
        ) SELECT * FROM filter_op"
      `)
      expect(compiled.paramSlots).toMatchInlineSnapshot(`
        [
          {
            "fieldPath": "/filter.value",
            "index": 1,
            "type": "string",
          },
        ]
      `)
    })

    it('FilterOp: greater than', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('age')
      filterOp.inputs.condition.setValue('greater than')
      filterOp.inputs.value.setValue('25')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "age" > $1
        ) SELECT * FROM filter_op"
      `)
    })

    it('FilterOp: less than or equal', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('price')
      filterOp.inputs.condition.setValue('less than or equal')
      filterOp.inputs.value.setValue('100')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "price" = $1
        ) SELECT * FROM filter_op"
      `)
    })

    it('FilterOp: contains', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('name')
      filterOp.inputs.condition.setValue('contains')
      filterOp.inputs.value.setValue('smith')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "name" LIKE '%' || $1 || '%'
        ) SELECT * FROM filter_op"
      `)
    })

    it('FilterOp: starts with', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('code')
      filterOp.inputs.condition.setValue('starts with')
      filterOp.inputs.value.setValue('US')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "code" = $1
        ) SELECT * FROM filter_op"
      `)
    })

    it('FilterOp: in', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('country')
      filterOp.inputs.condition.setValue('in')
      filterOp.inputs.value.setValue('USA,Canada,Mexico')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "country" IN ($2, $3, $4)
        ) SELECT * FROM filter_op"
      `)
      // IN clause generates extra params for each value + the original value field
      expect(compiled.paramSlots.length).toBeGreaterThanOrEqual(3)
    })

    it('FilterOp: not in', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('status')
      filterOp.inputs.condition.setValue('not in')
      filterOp.inputs.value.setValue('deleted,archived')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM  WHERE "status" NOT IN ($2, $3)
        ) SELECT * FROM filter_op"
      `)
    })

    it('SortOp: ascending', () => {
      const sortOp = new SortOp('/sort')
      sortOp.inputs.key.setValue('timestamp')
      sortOp.inputs.order.setValue('asc')

      const adapted = adaptOperator(sortOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH sort AS (
        /* operator: /sort */
        /* type: Sort */
        SELECT * FROM  ORDER BY "timestamp" ASC
        ) SELECT * FROM sort"
      `)
      expect(compiled.paramSlots).toEqual([])
    })

    it('SortOp: descending', () => {
      const sortOp = new SortOp('/sort')
      sortOp.inputs.key.setValue('score')
      sortOp.inputs.order.setValue('desc')

      const adapted = adaptOperator(sortOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH sort AS (
        /* operator: /sort */
        /* type: Sort */
        SELECT * FROM  ORDER BY "score" DESC
        ) SELECT * FROM sort"
      `)
    })

    it('SliceOp: first 100 rows', () => {
      const sliceOp = new SliceOp('/slice')
      sliceOp.inputs.start.setValue(0)
      sliceOp.inputs.end.setValue(100)

      const adapted = adaptOperator(sliceOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH slice AS (
        /* operator: /slice */
        /* type: Slice */
        SELECT * FROM  LIMIT $1 OFFSET $2
        ) SELECT * FROM slice"
      `)
      expect(compiled.paramSlots).toMatchInlineSnapshot(`
        [
          {
            "fieldPath": "/slice.end",
            "index": 1,
            "type": "number",
          },
          {
            "fieldPath": "/slice.start",
            "index": 2,
            "type": "number",
          },
        ]
      `)
    })

    it('SliceOp: skip first 50, take next 25', () => {
      const sliceOp = new SliceOp('/slice')
      sliceOp.inputs.start.setValue(50)
      sliceOp.inputs.end.setValue(75)

      const adapted = adaptOperator(sliceOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('LIMIT $1 OFFSET $2')
    })

    it('UniqueOp: specific columns', () => {
      const uniqueOp = new UniqueOp('/unique')
      uniqueOp.inputs.columns.setValue('user_id,session_id')

      const adapted = adaptOperator(uniqueOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH unique AS (
        /* operator: /unique */
        /* type: Unique */
        SELECT DISTINCT ON ("user_id", "session_id") * FROM 
        ) SELECT * FROM unique"
      `)
    })

    it('UniqueOp: all columns', () => {
      const uniqueOp = new UniqueOp('/unique')
      uniqueOp.inputs.columns.setValue('')

      const adapted = adaptOperator(uniqueOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH unique AS (
        /* operator: /unique */
        /* type: Unique */
        SELECT DISTINCT * FROM 
        ) SELECT * FROM unique"
      `)
    })

    it('GroupByOp: single aggregation', () => {
      const groupByOp = new GroupByOp('/group')
      groupByOp.inputs.groupByColumns.setValue('region')
      groupByOp.inputs.aggregations.setValue('sum(sales) as total_sales')

      const adapted = adaptOperator(groupByOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH group_op AS (
        /* operator: /group */
        /* type: GroupBy */
        SELECT "region", SUM("sales") AS "total_sales" FROM  GROUP BY "region"
        ) SELECT * FROM group_op"
      `)
    })

    it('GroupByOp: multiple aggregations', () => {
      const groupByOp = new GroupByOp('/group')
      groupByOp.inputs.groupByColumns.setValue('category,region')
      groupByOp.inputs.aggregations.setValue('sum(revenue) as total; count(*) as count; avg(price) as avg_price')

      const adapted = adaptOperator(groupByOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('GROUP BY "category", "region"')
      expect(compiled.sql).toContain('SUM("revenue") AS "total"')
      expect(compiled.sql).toContain('COUNT(*) AS "count"')
      expect(compiled.sql).toContain('AVG("price") AS "avg_price"')
    })

    it('WindowOp: rolling sum with partition', () => {
      const windowOp = new WindowOp('/window')
      windowOp.inputs.column.setValue('revenue')
      windowOp.inputs.function.setValue('sum')
      windowOp.inputs.partitionBy.setValue('store_id')
      windowOp.inputs.orderBy.setValue('date')
      windowOp.inputs.order.setValue('asc')
      windowOp.inputs.windowSize.setValue(7)
      windowOp.inputs.outputColumn.setValue('rolling_7day')

      const adapted = adaptOperator(windowOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('SUM("revenue") OVER (')
      expect(compiled.sql).toContain('PARTITION BY "store_id"')
      expect(compiled.sql).toContain('ORDER BY "date" ASC')
      expect(compiled.sql).toContain('6 PRECEDING')
      expect(compiled.sql).toContain('AS "rolling_7day"')
    })

    it('JoinOp: inner join', () => {
      const joinOp = new JoinOp('/join')
      joinOp.inputs.leftKey.setValue('user_id')
      joinOp.inputs.rightKey.setValue('id')
      joinOp.inputs.joinType.setValue('inner')

      const adapted = adaptOperator(joinOp as any, () => ['/left', '/right'])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('INNER JOIN')
      expect(compiled.sql).toContain('"user_id"')
      expect(compiled.sql).toContain('"id"')
    })

    it('JoinOp: left join', () => {
      const joinOp = new JoinOp('/join')
      joinOp.inputs.leftKey.setValue('product_id')
      joinOp.inputs.rightKey.setValue('id')
      joinOp.inputs.joinType.setValue('left')

      const adapted = adaptOperator(joinOp as any, () => ['/orders', '/products'])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('LEFT JOIN')
    })
  })

  describe('Multi-operator chains', () => {
    it('File→Filter: basic ETL', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('data.csv')
      fileOp.inputs.format.setValue('csv')

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('active')
      filterOp.inputs.condition.setValue('equals')
      filterOp.inputs.value.setValue('true')

      const adaptedFile = adaptOperator(fileOp as any, () => [])
      const adaptedFilter = adaptOperator(filterOp as any, () => ['/data'])

      const compiled = compile([adaptedFile!, adaptedFilter!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH
          data AS (
        /* operator: /data */
        /* type: File */
        SELECT * FROM read_csv_auto($1, header=true, auto_detect=true)
        ),
          filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM data WHERE "active" = $2
        )
        SELECT * FROM filter_op"
      `)
      expect(compiled.paramSlots).toHaveLength(2)
      expect(compiled.operatorAliases.get('/data')).toBe('data')
      expect(compiled.operatorAliases.get('/filter')).toBe('filter_op')
    })

    it('File→Filter→Sort: ordered filtered data', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('sales.csv')
      fileOp.inputs.format.setValue('csv')

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('amount')
      filterOp.inputs.condition.setValue('greater than')
      filterOp.inputs.value.setValue('1000')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.key.setValue('amount')
      sortOp.inputs.order.setValue('desc')

      const adaptedFile = adaptOperator(fileOp as any, () => [])
      const adaptedFilter = adaptOperator(filterOp as any, () => ['/data'])
      const adaptedSort = adaptOperator(sortOp as any, () => ['/filter'])

      const compiled = compile([adaptedFile!, adaptedFilter!, adaptedSort!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH
          data AS (
        /* operator: /data */
        /* type: File */
        SELECT * FROM read_csv_auto($1, header=true, auto_detect=true)
        ),
          filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM data WHERE "amount" > $2
        ),
          sort AS (
        /* operator: /sort */
        /* type: Sort */
        SELECT * FROM filter_op ORDER BY "amount" DESC
        )
        SELECT * FROM sort"
      `)
    })

    it('File→Filter→Sort→Slice: top-N query', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('scores.csv')
      fileOp.inputs.format.setValue('csv')

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('valid')
      filterOp.inputs.condition.setValue('equals')
      filterOp.inputs.value.setValue('true')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.key.setValue('score')
      sortOp.inputs.order.setValue('desc')

      const sliceOp = new SliceOp('/slice')
      sliceOp.inputs.start.setValue(0)
      sliceOp.inputs.end.setValue(10)

      const adaptedFile = adaptOperator(fileOp as any, () => [])
      const adaptedFilter = adaptOperator(filterOp as any, () => ['/data'])
      const adaptedSort = adaptOperator(sortOp as any, () => ['/filter'])
      const adaptedSlice = adaptOperator(sliceOp as any, () => ['/sort'])

      const compiled = compile([adaptedFile!, adaptedFilter!, adaptedSort!, adaptedSlice!])

      expect(compiled.sql).toMatchInlineSnapshot(`
        "WITH
          data AS (
        /* operator: /data */
        /* type: File */
        SELECT * FROM read_csv_auto($1, header=true, auto_detect=true)
        ),
          filter_op AS (
        /* operator: /filter */
        /* type: FilterOp */
        SELECT * FROM data WHERE "valid" = $2
        ),
          sort AS (
        /* operator: /sort */
        /* type: Sort */
        SELECT * FROM filter_op ORDER BY "score" DESC
        ),
          slice AS (
        /* operator: /slice */
        /* type: Slice */
        SELECT * FROM sort LIMIT $3 OFFSET $4
        )
        SELECT * FROM slice"
      `)
      expect(compiled.paramSlots).toHaveLength(4)
    })

    it('File→GroupBy→Sort: aggregation with ordering', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('transactions.csv')
      fileOp.inputs.format.setValue('csv')

      const groupByOp = new GroupByOp('/group')
      groupByOp.inputs.groupByColumns.setValue('merchant')
      groupByOp.inputs.aggregations.setValue('sum(amount) as total')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.key.setValue('total')
      sortOp.inputs.order.setValue('desc')

      const adaptedFile = adaptOperator(fileOp as any, () => [])
      const adaptedGroup = adaptOperator(groupByOp as any, () => ['/data'])
      const adaptedSort = adaptOperator(sortOp as any, () => ['/group'])

      const compiled = compile([adaptedFile!, adaptedGroup!, adaptedSort!])

      expect(compiled.sql).toContain('GROUP BY "merchant"')
      expect(compiled.sql).toContain('SUM("amount") AS "total"')
      expect(compiled.sql).toContain('ORDER BY "total" DESC')
    })

    it('File→Unique→Sort: deduplication with ordering', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('events.csv')
      fileOp.inputs.format.setValue('csv')

      const uniqueOp = new UniqueOp('/unique')
      uniqueOp.inputs.columns.setValue('user_id')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.key.setValue('timestamp')
      sortOp.inputs.order.setValue('asc')

      const adaptedFile = adaptOperator(fileOp as any, () => [])
      const adaptedUnique = adaptOperator(uniqueOp as any, () => ['/data'])
      const adaptedSort = adaptOperator(sortOp as any, () => ['/unique'])

      const compiled = compile([adaptedFile!, adaptedUnique!, adaptedSort!])

      expect(compiled.sql).toContain('DISTINCT ON ("user_id")')
      expect(compiled.sql).toContain('ORDER BY "timestamp" ASC')
    })

    it('File→Window→Filter: window function with filtering', () => {
      const fileOp = new FileOp('/data')
      fileOp.inputs.url.setValue('timeseries.csv')
      fileOp.inputs.format.setValue('csv')

      const windowOp = new WindowOp('/window')
      windowOp.inputs.column.setValue('value')
      windowOp.inputs.function.setValue('avg')
      windowOp.inputs.partitionBy.setValue('sensor_id')
      windowOp.inputs.orderBy.setValue('timestamp')
      windowOp.inputs.order.setValue('asc')
      windowOp.inputs.windowSize.setValue(5)
      windowOp.inputs.outputColumn.setValue('moving_avg')

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('moving_avg')
      filterOp.inputs.condition.setValue('greater than')
      filterOp.inputs.value.setValue('100')

      const adaptedFile = adaptOperator(fileOp as any, () => [])
      const adaptedWindow = adaptOperator(windowOp as any, () => ['/data'])
      const adaptedFilter = adaptOperator(filterOp as any, () => ['/window'])

      const compiled = compile([adaptedFile!, adaptedWindow!, adaptedFilter!])

      expect(compiled.sql).toContain('AVG("value") OVER (')
      expect(compiled.sql).toContain('PARTITION BY "sensor_id"')
      expect(compiled.sql).toContain('WHERE "moving_avg" > $2')
    })
  })

  describe('Complex operator graphs', () => {
    it('Multiple filters in sequence', () => {
      const filter1 = new FilterOp('/filter1')
      filter1.inputs.columnName.setValue('age')
      filter1.inputs.condition.setValue('greater than')
      filter1.inputs.value.setValue('18')

      const filter2 = new FilterOp('/filter2')
      filter2.inputs.columnName.setValue('status')
      filter2.inputs.condition.setValue('equals')
      filter2.inputs.value.setValue('active')

      const filter3 = new FilterOp('/filter3')
      filter3.inputs.columnName.setValue('verified')
      filter3.inputs.condition.setValue('equals')
      filter3.inputs.value.setValue('true')

      const adapted1 = adaptOperator(filter1 as any, () => [])
      const adapted2 = adaptOperator(filter2 as any, () => ['/filter1'])
      const adapted3 = adaptOperator(filter3 as any, () => ['/filter2'])

      const compiled = compile([adapted1!, adapted2!, adapted3!])

      expect(compiled.sql).toContain('WHERE "age" > $1')
      expect(compiled.sql).toContain('WHERE "status" = $2')
      expect(compiled.sql).toContain('WHERE "verified" = $3')
      expect(compiled.paramSlots).toHaveLength(3)
    })

    it('Join followed by aggregation', () => {
      // Simulating File→Join→GroupBy
      // Since we need two upstreams for join, we'll use placeholders
      const joinOp = new JoinOp('/join')
      joinOp.inputs.leftKey.setValue('product_id')
      joinOp.inputs.rightKey.setValue('id')
      joinOp.inputs.joinType.setValue('inner')

      const groupByOp = new GroupByOp('/group')
      groupByOp.inputs.groupByColumns.setValue('category')
      groupByOp.inputs.aggregations.setValue('count(*) as product_count; sum(price) as total_price')

      const adaptedJoin = adaptOperator(joinOp as any, () => ['/orders', '/products'])
      const adaptedGroup = adaptOperator(groupByOp as any, () => ['/join'])

      const compiled = compile([adaptedJoin!, adaptedGroup!])

      expect(compiled.sql).toContain('INNER JOIN')
      expect(compiled.sql).toContain('GROUP BY "category"')
      expect(compiled.sql).toContain('COUNT(*) AS "product_count"')
      expect(compiled.sql).toContain('SUM("price") AS "total_price"')
    })
  })

  describe('Edge cases', () => {
    it('Empty IN clause compiles to WHERE FALSE', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('status')
      filterOp.inputs.condition.setValue('in')
      filterOp.inputs.value.setValue('')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('WHERE FALSE')
    })

    it('Empty NOT IN clause compiles to WHERE TRUE', () => {
      const filterOp = new FilterOp('/filter')
      filterOp.inputs.columnName.setValue('status')
      filterOp.inputs.condition.setValue('not in')
      filterOp.inputs.value.setValue('')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.sql).toContain('WHERE TRUE')
    })

    it('Operator IDs with special characters get sanitized', () => {
      const filterOp = new FilterOp('/my-filter/nested')
      filterOp.inputs.columnName.setValue('x')
      filterOp.inputs.condition.setValue('equals')
      filterOp.inputs.value.setValue('1')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.operatorAliases.get('/my-filter/nested')).toMatch(/^my_filter_nested$/)
    })

    it('SQL reserved words in operator IDs get suffixed', () => {
      const filterOp = new FilterOp('/select')
      filterOp.inputs.columnName.setValue('x')
      filterOp.inputs.condition.setValue('equals')
      filterOp.inputs.value.setValue('1')

      const adapted = adaptOperator(filterOp as any, () => [])
      const compiled = compile([adapted!])

      expect(compiled.operatorAliases.get('/select')).toBe('select_op')
    })
  })
})
