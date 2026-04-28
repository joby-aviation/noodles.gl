# TableEditorOp v2: Typed Schema System

## Overview

The TableEditorOp v2 is a complete rewrite of the table editor with a typed schema system, providing an Airtable-like experience with Noodles-native field types.

## Features

### Typed Columns

Each column has a specific type with validation and specialized editors:

| Type | Description | Editor | Example |
|------|-------------|--------|---------|
| `number` | Numeric values | Scrubbable input with min/max/step | `42`, `3.14159` |
| `string` | Text values | Text input | `"Hello World"` |
| `boolean` | True/false | Toggle switch | `true`, `false` |
| `color` | Hex colors | Color picker | `#ff5733` |
| `point2d` | Coordinates [lng, lat] | Dual number inputs + geocoder | `[-74.006, 40.7128]` |
| `point3d` | 3D coordinates | Triple number inputs | `[x, y, z]` |
| `vec2` | 2D vectors | Dual number inputs | `[1.0, 2.0]` |
| `vec3` | 3D vectors | Triple number inputs | `[1.0, 2.0, 3.0]` |
| `date` | Date values | Date picker | `"2024-01-15"` |
| `stringLiteral` | Enum values | Dropdown | `"option1"` |

### Schema System

**Hybrid Approach:**
- **Infers schema from data** when schema input is not provided
- **Allows explicit schema definition** for empty tables or type overrides
- **Validates data** against schema on every execution

**Schema Structure:**
```typescript
{
  columns: [
    {
      name: 'city',
      type: 'string',
      defaultValue: ''
    },
    {
      name: 'position',
      type: 'point2d',
      defaultValue: [0, 0],
      options: {
        geocoder: true  // Enable geocoder button
      }
    },
    {
      name: 'population',
      type: 'number',
      defaultValue: 0,
      options: {
        min: 0,
        max: 10000000,
        step: 1
      }
    }
  ]
}
```

### Schema Editor Dialog

**Features:**
- Add, edit, delete, and reorder columns
- Set column type and options
- Quick-add templates:
  - **Position XYZ**: Adds x, y, z number columns
  - **Color RGB**: Adds r, g, b number columns (0-255)
  - **Lat/Lng**: Adds a point2d column

**Type-Specific Options:**

**Number:**
- `min`: Minimum value
- `max`: Maximum value
- `step`: Increment step

**Point2D:**
- `geocoder`: Enable geocoder button for address lookup (coming soon)

**StringLiteral:**
- `values`: Array of allowed values (dropdown options)

### UI Features

- **Inline editing**: Click cell to edit
- **Add/delete rows**: Add button in toolbar, delete button per row
- **Schema management**: Edit Schema dialog for column configuration
- **Row numbers**: Visual index for each row
- **Stats display**: Shows row × column count
- **Keyboard navigation**: Enter to confirm, Escape to cancel

### Data Flow

**Inputs:**
- `data`: Array of objects (rows)
- `schema`: Optional schema override (TableSchema | null)

**Outputs:**
- `data`: Validated data array
- `schema`: Computed schema (inferred or explicit)

**Execution:**
1. If schema input provided and valid → use it
2. Otherwise → infer schema from data
3. Validate data against schema
4. Apply defaults for missing values
5. Warn about invalid values (console)
6. Return validated data + schema

## Usage Examples

### Example 1: Cities Table

```json
{
  "type": "TableEditorOp",
  "data": {
    "inputs": {
      "schema": {
        "columns": [
          { "name": "city", "type": "string" },
          { "name": "position", "type": "point2d", "options": { "geocoder": true } },
          { "name": "population", "type": "number", "options": { "min": 0 } },
          { "name": "color", "type": "color" }
        ]
      },
      "data": [
        {
          "city": "NYC",
          "position": [-74.006, 40.7128],
          "population": 8336817,
          "color": "#ff5733"
        }
      ]
    }
  }
}
```

### Example 2: Schema Inference

```json
{
  "type": "TableEditorOp",
  "data": {
    "inputs": {
      "data": [
        {
          "name": "Alice",
          "score": 95,
          "active": true,
          "color": "#ff0000",
          "location": [10, 20]
        }
      ]
    }
  }
}
```

Schema automatically inferred as:
- `name`: string
- `score`: number
- `active`: boolean
- `color`: color (detected from hex format)
- `location`: point2d (detected from [number, number] array)

### Example 3: Empty Table with Schema

```json
{
  "type": "TableEditorOp",
  "data": {
    "inputs": {
      "schema": {
        "columns": [
          { "name": "task", "type": "string", "defaultValue": "" },
          { "name": "priority", "type": "number", "defaultValue": 1, "options": { "min": 1, "max": 5 } },
          { "name": "completed", "type": "boolean", "defaultValue": false }
        ]
      },
      "data": []
    }
  }
}
```

Use "Add Row" button to create rows with default values.

## Integration with Noodles

### Connecting to Visualizations

**Example: Scatter plot from table data**

```
[TableEditorOp].out.data → [ScatterplotLayerOp].par.data
```

**Accessor expressions:**
```javascript
// In ScatterplotLayerOp
getPosition: "d => d.position"
getRadius: "d => Math.sqrt(d.population) * 5"
getFillColor: "d => hexToColor(d.color)"
```

### Downstream Operations

**Filter by boolean:**
```javascript
// In FilterOp
op('/table').out.data.filter(d => d.active)
```

**DuckDB queries:**
```sql
-- In DuckDbOp
SELECT city, population
FROM {{/table.out.data}}
WHERE population > 1000000
ORDER BY population DESC
```

## Migration from Old TableEditorOp

**Backward Compatibility:**
- Old projects automatically infer schema on load
- No manual migration required
- Data structure unchanged (still array of objects)
- New schema input/output added (optional)

**Breaking Changes:**
- None - fully backward compatible

## Architecture

### Why TanStack Table?

- **Headless**: Logic-only (~25KB), reuses PrimeReact UI components
- **Type-safe**: Generic column types map to Noodles Field types
- **No stale closures**: Reactive state management eliminates the bug from PRs #374 and #286
- **Observable-friendly**: Callback-based, works with RxJS
- **Future-proof**: Easy to add cell-level keyframing later

### Key Design Decisions

1. **Hybrid schema approach**: Best of both worlds - works with existing data, enables new capabilities
2. **Validation on execute**: Data validated on every operator execution, not just on edit
3. **Schema as output**: Downstream operators can inspect column types
4. **Default values**: Missing data gets sensible defaults based on type
5. **No stale closures**: TanStack's reactive system eliminates synchronization issues

## Future Enhancements

### Planned Features

- **Geocoder integration**: Address → coordinates for Point2D columns
- **Import/Export CSV**: Direct CSV import with type inference
- **Row reordering**: Drag-and-drop row reorder
- **Column reordering**: Drag-and-drop column reorder
- **Bulk operations**: Select multiple rows, bulk delete/edit
- **Sort/filter UI**: Built-in sort and filter controls
- **Cell formulas**: Computed cells (like spreadsheets)

### Future Keyframing Support

**Architecture ready for:**
```typescript
interface CellValue {
  value: unknown
  expression?: string       // "lerp(10, 100, $time)"
  keyframes?: Keyframe[]   // Timeline keyframes
}
```

**Benefits:**
- Individual cells can be animated
- Cells can have reactive expressions
- Integrates with timeline system
- No implementation yet - deferred per requirements

## Testing

**Unit Tests:**
```bash
npm test table-schema.test.ts
```

**Manual Testing:**
1. Load example: `http://localhost:5173/noodles/table-editor-demo`
2. Test inline editing for all column types
3. Test schema editor (add/edit/delete columns)
4. Test row operations (add/delete)
5. Test data flow to visualizations
6. Test validation (try invalid values)

## Troubleshooting

**Issue: Cell edits not saving**
- Check browser console for validation errors
- Ensure cell value matches column type
- Try refreshing the page

**Issue: Schema editor not opening**
- Check for JavaScript errors in console
- Ensure Radix UI dependencies are installed

**Issue: Invalid default values**
- Check schema defaultValue matches column type
- Use `getDefaultValue(schema)` helper

**Issue: Geocoder button does nothing**
- Geocoder integration not yet implemented
- Button is placeholder for future feature

## API Reference

### TableSchema

```typescript
interface TableSchema {
  columns: ColumnSchema[]
}

interface ColumnSchema {
  name: string
  type: ColumnType
  options?: Record<string, unknown>
  defaultValue?: unknown
}

type ColumnType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'color'
  | 'point2d'
  | 'point3d'
  | 'vec2'
  | 'vec3'
  | 'date'
  | 'stringLiteral'
```

### Functions

```typescript
// Infer schema from data
inferSchema(data: unknown[]): TableSchema

// Get default value for column type
getDefaultValue(schema: ColumnSchema): unknown

// Validate value against schema
validateValue(value: unknown, schema: ColumnSchema): boolean

// Validate entire table data
validateTableData(data: unknown[], schema: TableSchema): unknown[]
```

## Performance

- **Schema inference**: O(n) where n = number of columns (only first row)
- **Validation**: O(n×m) where n = rows, m = columns
- **Rendering**: Virtualized for large tables (TanStack Table)
- **Memory**: ~25KB bundle size increase (TanStack Table)

## Credits

- Built with [TanStack Table v8](https://tanstack.com/table/v8)
- Leverages PR #231's custom field infrastructure
- Fixes stale closure bugs from PRs #374 and #286
