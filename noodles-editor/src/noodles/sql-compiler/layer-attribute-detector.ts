// Detect layer operator accessor fields that can be SQL-compiled
// Handles cases like: getRadius: 'population * 50' or getPosition: '[d.lng, d.lat, 0]'

import type { IOperator, Operator } from '../operators'
import {
  attributeColumnName,
  canTranspileToSql,
  expressionToSql,
  parseArrayExpression,
} from './expression-to-sql'

export interface LayerAttributeSpec {
  layerOpId: string
  fieldName: string // e.g., 'getRadius', 'getPosition', 'getFillColor'
  attributeName: string // e.g., 'radius', 'position', 'fillColor'
  expression: string
  size: number // 1 for scalar, 3 for position, 4 for RGBA
  type: 'float' | 'uint8'
  sqlColumns: string[] // SQL expressions for each component
}

// Map accessor field names to attribute info
const ACCESSOR_FIELD_MAP: Record<
  string,
  { attributeName: string; size: number; type: 'float' | 'uint8' }
> = {
  // Positions
  getPosition: { attributeName: 'position', size: 3, type: 'float' },
  getSourcePosition: { attributeName: 'sourcePosition', size: 3, type: 'float' },
  getTargetPosition: { attributeName: 'targetPosition', size: 3, type: 'float' },

  // Colors (RGBA)
  getFillColor: { attributeName: 'fillColor', size: 4, type: 'uint8' },
  getLineColor: { attributeName: 'lineColor', size: 4, type: 'uint8' },
  getColor: { attributeName: 'color', size: 4, type: 'uint8' },
  getSourceColor: { attributeName: 'sourceColor', size: 4, type: 'uint8' },
  getTargetColor: { attributeName: 'targetColor', size: 4, type: 'uint8' },

  // Scalars
  getRadius: { attributeName: 'radius', size: 1, type: 'float' },
  getSize: { attributeName: 'size', size: 1, type: 'float' },
  getWidth: { attributeName: 'width', size: 1, type: 'float' },
  getLineWidth: { attributeName: 'lineWidth', size: 1, type: 'float' },
  getElevation: { attributeName: 'elevation', size: 1, type: 'float' },
  getHeight: { attributeName: 'height', size: 1, type: 'float' },
  getAngle: { attributeName: 'angle', size: 1, type: 'float' },
  getWeight: { attributeName: 'weight', size: 1, type: 'float' },

  // Angles/orientations
  getTilt: { attributeName: 'tilt', size: 1, type: 'float' },
  getOrientation: { attributeName: 'orientation', size: 3, type: 'float' },

  // Filter values
  getFilterValue: { attributeName: 'filterValue', size: 1, type: 'float' },
}

// Detect layer operators downstream of SQL chains that have string expressions in accessor fields
export function detectLayerAttributes(
  compiledOpId: string,
  getOperator: (id: string) => Operator<IOperator> | undefined,
  getDownstreamIds: (opId: string) => string[]
): LayerAttributeSpec[] {
  const attributes: LayerAttributeSpec[] = []

  // BFS to find layer operators (they may be indirect descendants)
  const visited = new Set<string>()
  const queue = [compiledOpId]
  visited.add(compiledOpId)

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const downstreamIds = getDownstreamIds(currentId)

    for (const downstreamId of downstreamIds) {
      if (visited.has(downstreamId)) continue
      visited.add(downstreamId)

      const op = getOperator(downstreamId)
      if (!op) continue

      const opType = (op.constructor as { displayName?: string }).displayName
      if (!opType) continue

      // Check if it's a layer operator (ends with 'Layer')
      if (!opType.endsWith('Layer')) {
        // Not a layer, but continue searching downstream
        queue.push(downstreamId)
        continue
      }

      // Found a layer operator - check its accessor fields
      if (!op.inputs || typeof op.inputs !== 'object') {
        // Skip if no inputs
        continue
      }

      for (const [fieldName, field] of Object.entries(op.inputs)) {
        if (!field || typeof field !== 'object') continue

        // Check if this is a known accessor field
        const accessorInfo = ACCESSOR_FIELD_MAP[fieldName]
        if (!accessorInfo) continue

        // Check if field has accessor capability
        if (!('accessor' in field) || !field.accessor) continue

        // Get the field value
        const value = 'value' in field ? field.value : undefined

        // Check if it's a string expression (not a function, not an object)
        if (typeof value !== 'string') continue

        // Check if expression is SQL-translatable
        if (!canTranspileToSql(value)) continue

        // Parse the expression to SQL
        const sqlColumns: string[] = []

        // Try array expression first
        const arrayResult = parseArrayExpression(value)
        if (arrayResult.isTranslatable) {
          for (const col of arrayResult.columns) {
            sqlColumns.push(col.sql)
          }
        } else {
          // Single expression
          const result = expressionToSql(value)
          if (result.isTranslatable) {
            sqlColumns.push(result.sql)
          }
        }

        if (sqlColumns.length > 0) {
          attributes.push({
            layerOpId: downstreamId,
            fieldName,
            attributeName: accessorInfo.attributeName,
            expression: value,
            size: accessorInfo.size,
            type: accessorInfo.type,
            sqlColumns,
          })
        }
      }
    }
  }

  return attributes
}

// Generate SQL SELECT clause with layer attribute columns
export function generateLayerAttributeColumns(attributes: LayerAttributeSpec[]): string[] {
  const columns: string[] = []

  for (const attr of attributes) {
    for (let i = 0; i < attr.sqlColumns.length; i++) {
      const sqlExpr = attr.sqlColumns[i]
      const columnName = attributeColumnName(attr.attributeName, i)

      // Cast to appropriate type
      const castType = attr.type === 'uint8' ? 'UTINYINT' : 'FLOAT'
      columns.push(`CAST(${sqlExpr} AS ${castType}) AS ${columnName}`)
    }
  }

  return columns
}

// Extract SQL-computed attributes from Arrow table and create binary attributes
export function extractLayerAttributes(
  data: unknown,
  layerAttributes: LayerAttributeSpec[]
): Record<string, { values: Float32Array | Uint8Array; size: number }> {
  const attributes: Record<string, { values: Float32Array | Uint8Array; size: number }> = {}

  // Check if data is Arrow table
  if (!data || typeof data !== 'object' || !('schema' in data)) {
    return attributes
  }

  const table = data as {
    schema: { fields: Array<{ name: string }> }
    numRows: number
    getChild: (name: string) => { toArray: () => number[] }
  }

  // For each layer attribute, check if SQL-computed columns exist
  for (const attr of layerAttributes) {
    const columns: (Float32Array | Uint8Array)[] = []

    // Try to extract all components
    let allColumnsFound = true
    for (let i = 0; i < attr.size; i++) {
      const columnName = attributeColumnName(attr.attributeName, i)

      // Check if column exists
      const hasColumn = table.schema.fields.some(f => f.name === columnName)
      if (!hasColumn) {
        allColumnsFound = false
        break
      }

      // Extract column as typed array
      const column = table.getChild(columnName)
      const values = column.toArray()

      // Convert to appropriate typed array
      if (attr.type === 'uint8') {
        columns.push(new Uint8Array(values))
      } else {
        columns.push(new Float32Array(values))
      }
    }

    if (allColumnsFound && columns.length === attr.size) {
      // Interleave columns into single typed array
      const numRows = table.numRows
      const ArrayType = attr.type === 'uint8' ? Uint8Array : Float32Array
      const interleaved = new ArrayType(numRows * attr.size)

      for (let row = 0; row < numRows; row++) {
        for (let component = 0; component < attr.size; component++) {
          interleaved[row * attr.size + component] = columns[component][row]
        }
      }

      attributes[attr.attributeName] = {
        values: interleaved,
        size: attr.size,
      }
    }
  }

  return attributes
}
