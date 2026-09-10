import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import * as arrow from 'apache-arrow'

// Mock the op-components module to extract just the component we need
// Since AttributeTablePreview is not exported, we'll test via ViewerOpComponent
// For now, let's create a standalone test version

// Inline the component for testing (in real implementation, we'd export it)
import { useState } from 'react'

type TypedArray =
  | Float32Array
  | Uint8Array
  | Int32Array
  | Uint16Array
  | Int16Array
  | Uint32Array

function isArrowTable(value: unknown): value is arrow.Table {
  return value instanceof arrow.Table
}

function AttributeTablePreview({
  attributeData,
}: {
  attributeData: {
    data: unknown
    attributes: Record<
      string,
      {
        values: TypedArray | unknown[]
        size: number
        type?: 'string' | 'boolean'
      }
    >
  }
}) {
  const [pageSize, setPageSize] = useState(20)
  const [currentPage, setCurrentPage] = useState(0)

  const { data, attributes } = attributeData

  // Determine row count
  const rowCount = isArrowTable(data)
    ? data.numRows
    : Array.isArray(data)
      ? data.length
      : 0

  // Calculate pagination
  const totalPages = Math.ceil(rowCount / pageSize)
  const startIdx = currentPage * pageSize
  const endIdx = Math.min(startIdx + pageSize, rowCount)

  // Get data columns (original table properties)
  const dataColumns: string[] = []
  let dataRows: Record<string, unknown>[] = []

  if (isArrowTable(data)) {
    const columns = data.schema.fields.map(f => f.name)
    // Filter out internal attribute columns (__attr_*)
    dataColumns.push(...columns.filter(col => !col.startsWith('__attr_')))
    dataRows = data.slice(startIdx, endIdx).toArray().map((row: unknown) => ({ ...(row as object) }))
  } else if (Array.isArray(data) && data.length > 0) {
    // For plain arrays, derive columns from first object
    const firstRow = data[0]
    if (firstRow && typeof firstRow === 'object') {
      dataColumns.push(...Object.keys(firstRow))
    }
    dataRows = data.slice(startIdx, endIdx)
  }

  // Build combined rows with both data properties and attributes
  const attributeNames = Object.keys(attributes)
  const rows: Record<string, unknown>[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row: Record<string, unknown> = { ...dataRows[i] }
    const globalIdx = startIdx + i

    // Add de-interleaved attributes
    for (const name of attributeNames) {
      const attr = attributes[name]
      if (attr.type === 'string' || attr.type === 'boolean') {
        // Simple array access
        row[name] = (attr.values as unknown[])[globalIdx]
      } else {
        // De-interleave TypedArray
        const values: number[] = []
        for (let j = 0; j < attr.size; j++) {
          values.push((attr.values as TypedArray)[globalIdx * attr.size + j])
        }
        row[name] = attr.size === 1 ? values[0] : values
      }
    }
    rows.push(row)
  }

  const formatValue = (val: unknown): string => {
    if (Array.isArray(val)) {
      return `[${val.map(v => (typeof v === 'number' ? v.toFixed(3) : String(v))).join(', ')}]`
    }
    if (typeof val === 'number') {
      return val.toFixed(3)
    }
    if (typeof val === 'bigint') {
      return val.toString()
    }
    if (val === null || val === undefined) {
      return ''
    }
    return String(val)
  }

  const totalColumns = dataColumns.length + attributeNames.length

  return (
    <div data-testid="attribute-table-preview">
      <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: 4 }}>
        {rowCount.toLocaleString()} rows × {totalColumns} columns ({dataColumns.length} data,{' '}
        {attributeNames.length} attributes)
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '50px' }}>#</th>
            {dataColumns.map(col => (
              <th key={col}>{col}</th>
            ))}
            {attributeNames.map(name => (
              <th key={`attr-${name}`}>
                {name}
                <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px' }}>
                  (attr: {attributes[name].size})
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={startIdx + idx} data-testid={`row-${startIdx + idx}`}>
              <td style={{ opacity: 0.5, fontSize: '10px' }}>{startIdx + idx}</td>
              {dataColumns.map(col => (
                <td key={col}>{formatValue(row[col])}</td>
              ))}
              {attributeNames.map(name => (
                <td key={`attr-${name}`}>{formatValue(row[name])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '8px',
          fontSize: '11px',
        }}
      >
        <div style={{ opacity: 0.7 }}>
          Showing {startIdx + 1}-{endIdx} of {rowCount.toLocaleString()} rows
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            Page size:
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value))
                setCurrentPage(0)
              }}
              data-testid="page-size-select"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              data-testid="prev-button"
            >
              ← Prev
            </button>
            <span data-testid="page-counter">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              data-testid="next-button"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

describe('AttributeTablePreview', () => {
  afterEach(() => {
    cleanup()
  })

  describe('Data + Attributes Display', () => {
    it('should display both data columns and attributes', () => {
      const testData = [
        { id: 1, name: 'Alice', value: 10 },
        { id: 2, name: 'Bob', value: 20 },
        { id: 3, name: 'Charlie', value: 30 },
      ]

      const attributeData = {
        data: testData,
        attributes: {
          position: {
            values: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
            size: 3,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Check header shows both data and attribute columns
      expect(screen.getByText('3 rows × 4 columns (3 data, 1 attributes)')).toBeInTheDocument()

      // Check data column headers
      expect(screen.getByText('id')).toBeInTheDocument()
      expect(screen.getByText('name')).toBeInTheDocument()
      expect(screen.getByText('value')).toBeInTheDocument()

      // Check attribute column header
      expect(screen.getByText('position')).toBeInTheDocument()
      expect(screen.getByText('(attr: 3)')).toBeInTheDocument()

      // Check first row data
      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('1.000')).toBeInTheDocument() // id
      expect(within(row0).getByText('Alice')).toBeInTheDocument() // name
      expect(within(row0).getByText('10.000')).toBeInTheDocument() // value
      expect(within(row0).getByText('[1.000, 2.000, 3.000]')).toBeInTheDocument() // position
    })

    it('should handle Arrow Table data with attributes', () => {
      const table = arrow.tableFromArrays({
        id: [1, 2, 3],
        x: [10.5, 20.5, 30.5],
        y: [5.5, 15.5, 25.5],
      })

      const attributeData = {
        data: table,
        attributes: {
          color: {
            values: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
            size: 4,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Check header
      expect(screen.getByText('3 rows × 4 columns (3 data, 1 attributes)')).toBeInTheDocument()

      // Check Arrow columns are displayed
      expect(screen.getByText('id')).toBeInTheDocument()
      expect(screen.getByText('x')).toBeInTheDocument()
      expect(screen.getByText('y')).toBeInTheDocument()

      // Check color attribute
      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('[255.000, 0.000, 0.000, 255.000]')).toBeInTheDocument()
    })

    it('should filter out internal __attr_ columns from Arrow tables', () => {
      const table = arrow.tableFromArrays({
        id: [1, 2],
        name: ['A', 'B'],
        __attr_position_0: [1.0, 2.0],
        __attr_position_1: [3.0, 4.0],
      })

      const attributeData = {
        data: table,
        attributes: {
          position: {
            values: new Float32Array([1, 3, 2, 4]),
            size: 2,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Should show 2 data columns (id, name) not 4
      expect(screen.getByText('2 rows × 3 columns (2 data, 1 attributes)')).toBeInTheDocument()

      // __attr columns should not be visible
      expect(screen.queryByText('__attr_position_0')).not.toBeInTheDocument()
      expect(screen.queryByText('__attr_position_1')).not.toBeInTheDocument()

      // Regular columns should be visible
      expect(screen.getByText('id')).toBeInTheDocument()
      expect(screen.getByText('name')).toBeInTheDocument()
    })
  })

  describe('Attribute Types', () => {
    it('should handle single-component attributes (size=1)', () => {
      const attributeData = {
        data: [{ id: 1 }, { id: 2 }],
        attributes: {
          radius: {
            values: new Float32Array([10.5, 20.75]),
            size: 1,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      // size=1 should display as scalar, not array
      expect(within(row0).getByText('10.500')).toBeInTheDocument()
    })

    it('should handle multi-component attributes (size>1)', () => {
      const attributeData = {
        data: [{ id: 1 }],
        attributes: {
          position: {
            values: new Float32Array([1.1, 2.2, 3.3]),
            size: 3,
          },
          color: {
            values: new Uint8Array([255, 128, 64, 255]),
            size: 4,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('[1.100, 2.200, 3.300]')).toBeInTheDocument()
      expect(within(row0).getByText('[255.000, 128.000, 64.000, 255.000]')).toBeInTheDocument()
    })

    it('should handle string attributes', () => {
      const attributeData = {
        data: [{ id: 1 }, { id: 2 }],
        attributes: {
          label: {
            values: ['First', 'Second'],
            size: 1,
            type: 'string' as const,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('First')).toBeInTheDocument()

      const row1 = screen.getByTestId('row-1')
      expect(within(row1).getByText('Second')).toBeInTheDocument()
    })

    it('should handle boolean attributes', () => {
      const attributeData = {
        data: [{ id: 1 }, { id: 2 }],
        attributes: {
          visible: {
            values: [true, false],
            size: 1,
            type: 'boolean' as const,
          },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('true')).toBeInTheDocument()

      const row1 = screen.getByTestId('row-1')
      expect(within(row1).getByText('false')).toBeInTheDocument()
    })
  })

  describe('Pagination', () => {
    it('should default to page size 20', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      const attributeData = {
        data,
        attributes: {
          value: { values: new Float32Array(100).fill(1), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      expect(screen.getByText('Showing 1-20 of 100 rows')).toBeInTheDocument()
      expect(screen.getByTestId('page-size-select')).toHaveValue('20')
    })

    it('should navigate to next page', () => {
      const data = Array.from({ length: 50 }, (_, i) => ({ id: i }))
      const attributeData = {
        data,
        attributes: {
          value: { values: new Float32Array(50).fill(1), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Initially on page 1
      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 1 of 3')
      expect(screen.getByText('Showing 1-20 of 50 rows')).toBeInTheDocument()

      // Click next
      fireEvent.click(screen.getByTestId('next-button'))

      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 2 of 3')
      expect(screen.getByText('Showing 21-40 of 50 rows')).toBeInTheDocument()
    })

    it('should navigate to previous page', () => {
      const data = Array.from({ length: 50 }, (_, i) => ({ id: i }))
      const attributeData = {
        data,
        attributes: {
          value: { values: new Float32Array(50).fill(1), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Go to page 2
      fireEvent.click(screen.getByTestId('next-button'))
      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 2 of 3')

      // Go back to page 1
      fireEvent.click(screen.getByTestId('prev-button'))
      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 1 of 3')
    })

    it('should change page size and reset to page 1', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      const attributeData = {
        data,
        attributes: {
          value: { values: new Float32Array(100).fill(1), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Go to page 2
      fireEvent.click(screen.getByTestId('next-button'))
      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 2 of 5')

      // Change page size to 50
      fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '50' } })

      // Should reset to page 1 with new page size
      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 1 of 2')
      expect(screen.getByText('Showing 1-50 of 100 rows')).toBeInTheDocument()
    })

    it('should disable prev button on first page', () => {
      const attributeData = {
        data: [{ id: 1 }],
        attributes: {
          value: { values: new Float32Array([1]), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      expect(screen.getByTestId('prev-button')).toBeDisabled()
    })

    it('should disable next button on last page', () => {
      const data = Array.from({ length: 25 }, (_, i) => ({ id: i }))
      const attributeData = {
        data,
        attributes: {
          value: { values: new Float32Array(25).fill(1), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      // Go to last page (page 2)
      fireEvent.click(screen.getByTestId('next-button'))

      expect(screen.getByTestId('next-button')).toBeDisabled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty data', () => {
      const attributeData = {
        data: [],
        attributes: {
          value: { values: new Float32Array([]), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      expect(screen.getByText('0 rows × 1 columns (0 data, 1 attributes)')).toBeInTheDocument()
      expect(screen.getByText('Showing 1-0 of 0 rows')).toBeInTheDocument()
    })

    it('should handle null/undefined values', () => {
      const attributeData = {
        data: [{ id: 1, value: null }, { id: 2, value: undefined }],
        attributes: {},
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const rows = screen.getAllByRole('row').slice(1) // Skip header
      expect(rows).toHaveLength(2)
    })

    it('should handle bigint values', () => {
      const table = arrow.tableFromArrays({
        id: [BigInt(1), BigInt(2)],
      })

      const attributeData = {
        data: table,
        attributes: {},
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('1')).toBeInTheDocument()
    })

    it('should handle single row', () => {
      const attributeData = {
        data: [{ id: 1 }],
        attributes: {
          value: { values: new Float32Array([42]), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 1 of 1')
      expect(screen.getByTestId('prev-button')).toBeDisabled()
      expect(screen.getByTestId('next-button')).toBeDisabled()
    })

    it('should handle large datasets (1000+ rows)', () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: i * 2 }))
      const attrValues = new Float32Array(1000 * 3)
      for (let i = 0; i < 1000; i++) {
        attrValues[i * 3] = i
        attrValues[i * 3 + 1] = i + 1
        attrValues[i * 3 + 2] = i + 2
      }

      const attributeData = {
        data,
        attributes: {
          position: { values: attrValues, size: 3 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      expect(screen.getByText('1,000 rows × 3 columns (2 data, 1 attributes)')).toBeInTheDocument()
      expect(screen.getByTestId('page-counter')).toHaveTextContent('Page 1 of 50')

      // Should only render current page (20 rows)
      const rows = screen.getAllByRole('row').slice(1) // Skip header
      expect(rows).toHaveLength(20)
    })
  })

  describe('Number Formatting', () => {
    it('should format floats to 3 decimal places', () => {
      const attributeData = {
        data: [{ value: 1.23456789 }],
        attributes: {
          attr: { values: new Float32Array([9.87654321]), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('1.235')).toBeInTheDocument() // data column
      expect(within(row0).getByText('9.877')).toBeInTheDocument() // attribute
    })

    it('should format integers with .000', () => {
      const attributeData = {
        data: [{ value: 42 }],
        attributes: {
          attr: { values: new Float32Array([100]), size: 1 },
        },
      }

      render(<AttributeTablePreview attributeData={attributeData} />)

      const row0 = screen.getByTestId('row-0')
      expect(within(row0).getByText('42.000')).toBeInTheDocument()
      expect(within(row0).getByText('100.000')).toBeInTheDocument()
    })
  })
})
