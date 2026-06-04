import { describe, it } from 'vitest'
import {
  FilterOp,
  GroupByOp,
  SliceOp,
  SortOp,
} from '../operators'

// Generate test data matching the SQL benchmarks
function generateTestData(count: number) {
  const data = []
  for (let i = 1; i <= count; i++) {
    const rand = Math.random()
    data.push({
      id: i,
      name: `name_${i}`,
      age: Math.floor(Math.random() * 100),
      department: rand < 0.33 ? 'Engineering' : rand < 0.66 ? 'Marketing' : 'Sales',
      salary: Math.floor(Math.random() * 200000),
    })
  }
  return data
}

describe('JS Execution Performance (for comparison with SQL)', () => {
  describe('Parameter Scrubbing Performance', () => {
    it('Filter → Sort → Slice with 1K rows', () => {
      const data = generateTestData(1000)

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.data.setValue(data)
      filterOp.inputs.columnName.setValue('age')
      filterOp.inputs.condition.setValue('greater than')
      filterOp.inputs.value.setValue('30')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.data.addConnection('filter-out', filterOp.outputs.data)
      sortOp.inputs.key.setValue('salary')
      sortOp.inputs.order.setValue('desc')
      sortOp.addUpstreamDependency(filterOp)

      const sliceOp = new SliceOp('/slice')
      sliceOp.inputs.data.addConnection('sort-out', sortOp.outputs.data)
      sliceOp.inputs.start.setValue(0)
      sliceOp.inputs.end.setValue(10)
      sliceOp.addUpstreamDependency(sortOp)

      // Warmup
      sliceOp.pull()

      // Benchmark parameter changes (like timeline scrubbing)
      const timings: number[] = []
      for (let frame = 0; frame < 30; frame++) {
        filterOp.inputs.value.setValue(String(20 + frame * 2))

        // Mark operators dirty so they re-execute
        filterOp.markDirty()
        sortOp.markDirty()
        sliceOp.markDirty()

        const start = performance.now()
        sliceOp.pull()
        timings.push(performance.now() - start)
      }

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length
      const max = Math.max(...timings)

      console.log('\nJS Filter→Sort→Slice (1K rows, 30 frames):')
      console.log(`  Average: ${avg.toFixed(2)}ms per frame`)
      console.log(`  Max: ${max.toFixed(2)}ms`)
      console.log(`  SQL comparison: ~1-2ms per frame (5-10x faster)`)
    })

    it('Filter → Sort → Slice with 10K rows', () => {
      const data = generateTestData(10000)

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.data.setValue(data)
      filterOp.inputs.columnName.setValue('age')
      filterOp.inputs.condition.setValue('greater than')
      filterOp.inputs.value.setValue('30')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.data.addConnection('filter-out', filterOp.outputs.data)
      sortOp.inputs.key.setValue('salary')
      sortOp.inputs.order.setValue('desc')
      sortOp.addUpstreamDependency(filterOp)

      const sliceOp = new SliceOp('/slice')
      sliceOp.inputs.data.addConnection('sort-out', sortOp.outputs.data)
      sliceOp.inputs.start.setValue(0)
      sliceOp.inputs.end.setValue(10)
      sliceOp.addUpstreamDependency(sortOp)

      // Warmup
      sliceOp.pull()

      // Benchmark
      const timings: number[] = []
      for (let frame = 0; frame < 30; frame++) {
        filterOp.inputs.value.setValue(String(20 + frame * 2))

        // Mark operators dirty so they re-execute
        filterOp.markDirty()
        sortOp.markDirty()
        sliceOp.markDirty()

        const start = performance.now()
        sliceOp.pull()
        timings.push(performance.now() - start)
      }

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length
      const max = Math.max(...timings)

      console.log('\nJS Filter→Sort→Slice (10K rows, 30 frames):')
      console.log(`  Average: ${avg.toFixed(2)}ms per frame`)
      console.log(`  Max: ${max.toFixed(2)}ms`)
      console.log(`  SQL comparison: ~5-10ms per frame (2-5x faster)`)
    })

    it('GroupBy → Sort with 10K rows', () => {
      const data = generateTestData(10000)

      const groupOp = new GroupByOp('/group')
      groupOp.inputs.data.setValue(data)
      groupOp.inputs.groupByColumns.setValue('department')
      groupOp.inputs.aggregations.setValue('AVG(salary) as avg_salary, COUNT(*) as count')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.data.addConnection('group-out', groupOp.outputs.data)
      sortOp.inputs.key.setValue('avg_salary')
      sortOp.inputs.order.setValue('desc')
      sortOp.addUpstreamDependency(groupOp)

      // Warmup
      sortOp.pull()

      // Benchmark parameter changes
      const timings: number[] = []
      for (let i = 0; i < 20; i++) {
        const order = i % 2 === 0 ? 'desc' : 'asc'
        sortOp.inputs.order.setValue(order)

        // Mark operators dirty so they re-execute
        groupOp.markDirty()
        sortOp.markDirty()

        const start = performance.now()
        sortOp.pull()
        timings.push(performance.now() - start)
      }

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length
      const max = Math.max(...timings)

      console.log('\nJS GroupBy→Sort (10K rows, 20 iterations):')
      console.log(`  Average: ${avg.toFixed(2)}ms`)
      console.log(`  Max: ${max.toFixed(2)}ms`)
      console.log(`  SQL comparison: ~3-8ms (2-4x faster)`)
    })
  })

  describe('Cold Start Performance', () => {
    it('First execution with 10K rows', () => {
      const data = generateTestData(10000)

      const filterOp = new FilterOp('/filter')
      filterOp.inputs.data.setValue(data)
      filterOp.inputs.columnName.setValue('age')
      filterOp.inputs.condition.setValue('greater than')
      filterOp.inputs.value.setValue('30')

      const sortOp = new SortOp('/sort')
      sortOp.inputs.data.addConnection('filter-out', filterOp.outputs.data)
      sortOp.inputs.key.setValue('salary')
      sortOp.inputs.order.setValue('desc')
      sortOp.addUpstreamDependency(filterOp)

      const start = performance.now()
      const result = sortOp.pull()
      const elapsed = performance.now() - start

      console.log('\nJS Cold Start (10K rows):')
      console.log(`  Time: ${elapsed.toFixed(2)}ms`)
      console.log(`  Result: ${result?.data?.length || 0} rows`)
      console.log(`  SQL comparison: ~10-20ms (similar for cold start)`)
    })
  })
})
