# Creating Operators

Operators are the core processing units in the Noodles.gl system. They take inputs, process data, and produce outputs that can be connected to other operators.

## Operator Fundamentals

### Basic Structure

```typescript
export class SliceOp extends Operator<SliceOp> {
  static displayName = 'Slice'
  static description = 'Slice an array of data'
  createInputs() {
    return {
      data: new DataField(),
      start: new NumberField(0, { min: 0, step: 1 }),
      end: new NumberField(10, { min: 0, step: 1, optional: true }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({
    data,
    start,
    end,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { data: data.slice(start, end) }
  }
}
```

### Key Principles

- **Pure Functions**: Operators should be deterministic (same inputs = same outputs)
- **Reactive**: Automatically re-execute when upstream data changes
- **Typed**: Use Zod schemas for input/output validation
- **Memoized**: Results are cached to avoid unnecessary recomputation

## Operator Categories

### Data Operators

- **JSONOp**: Load and parse JSON data
- **DuckDbOp**: SQL queries with reactive references
- **CSVOp**: Parse CSV files and data
- **GeocoderOp**: Convert addresses to coordinates

### Processing Operators

- **FilterOp**: Filter data based on conditions
- **MapOp**: Transform data arrays
- **GroupByOp**: Group and aggregate data
- **JoinOp**: Combine multiple datasets

### Math Operators

- **NumberOp**: Numeric constants and calculations
- **ExpressionOp**: Single-line JavaScript expressions
- **CodeOp**: Multi-line custom JavaScript code
- **AccessorOp**: Data accessor functions for Deck.gl

### Visualization Operators

- **ScatterplotLayerOp**: Point visualizations
- **PathLayerOp**: Line and route visualizations
- **H3HexagonLayerOp**: Hexagonal grid visualizations
- **HeatmapLayerOp**: Density visualizations

## Code Operators

### CodeOp

For complex data processing with full JavaScript support:

```javascript
// Example: Calculate distance between points
const distances = data.map(d => {
  const from = [d.start_lng, d.start_lat]
  const to = [d.end_lng, d.end_lat]
  return turf.distance(from, to, { units: 'kilometers' })
})

return distances
```

**Available globals:**

- `d3` - D3.js library
- `turf` - Turf.js geospatial functions
- `deck` - Deck.gl utilities
- `Plot` - Observable Plot
- All Operator classes for instantiation

### AccessorOp

For Deck.gl layer accessors (per-item functions):

```javascript
// Example: Get position from data item
[d.longitude, d.latitude]

// Example: Get color based on value
d.value > 100 ? [255, 0, 0] : [0, 255, 0]
```

**Context:**

- `d` - Current data item
- `data` - Full dataset array

### ExpressionOp

For simple single-line calculations:

```javascript
// Example: Calculate area
Math.PI * Math.pow(d.radius, 2)
```

## Operator Paths and References

### Fully Qualified Paths

Operators are identified by Unix-style paths that reflect their position in the container hierarchy:

- **Root operators**: `/operatorName` (e.g., `/code1`, `/threshold`)
- **Nested operators**: `/container/operatorName` (e.g., `/analysis/filter1`)
- **Deep nesting**: `/container/subcontainer/operatorName`

### Reactive References

Use `op('path')` with fully qualified or relative paths to reference other operators:

```javascript
// Absolute path reference
const threshold = op('/threshold').par.value
const filtered = data.filter(d => d.value > threshold)

// Relative path reference (same container)
const localData = op('./data-source').out.value
const processed = op('processor').out.value  // equivalent to './processor'

// Parent container reference
const parentConfig = op('../config').par.value
```

### Path Resolution

The `op()` function supports Unix-style path resolution, which means you can use `./`, `../`, and `operator` to reference other operators relative to the current operator:

- **Absolute paths**: `/path/to/operator` - from root
- **Relative paths**: `./operator` - same container
- **Parent paths**: `../operator` - parent container
- **Simple names**: `operator` - same container (equivalent to `./operator`)

## DuckDB Integration

DuckDbOp supports SQL with reactive mustache syntax using fully qualified paths:

```sql
SELECT * FROM data
WHERE population > {{/config/threshold.par.value}}
ORDER BY population DESC
LIMIT {{limit.par.value}}
```

### Enhanced Mustache Syntax

The `getFieldReferences()` function parses mustache templates with path support:

```sql
-- Absolute path references
SELECT * FROM data WHERE value > {{/threshold.par.value}}

-- Relative path references (same container)
SELECT * FROM data WHERE value > {{./threshold.par.value}}
SELECT * FROM data WHERE value > {{threshold.par.value}}  -- equivalent

-- Parent container references
SELECT * FROM data WHERE value > {{../config/threshold.par.value}}

-- Complex nested paths
SELECT * FROM data WHERE value > {{../../global/config.par.threshold}}
```

**Automatic Reference Detection**:
- Supports both `{{mustache}}` and `op('path')` function syntax
- Creates reactive connections automatically
- Resolves paths based on calling operator's context
- Handles multiple references in single templates

Path resolution in SQL:
- **Absolute paths**: `{{/container/operator.field.value}}`
- **Relative paths**: `{{./operator.field.value}}` or `{{operator.field.value}}`
- **Parent paths**: `{{../operator.field.value}}`

## Best Practices

### Performance

- Keep operators pure and stateless
- Avoid heavy computations in AccessorOps
- Use memoization for expensive calculations
- Batch data operations when possible

### Data Flow

- Design clear input/output contracts
- Use descriptive field names
- Validate data at operator boundaries
- Handle edge cases gracefully

### Code Organization

- Break complex logic into smaller operators
- Reuse common patterns as operator templates
- Document custom operators thoroughly
- Test operators in isolation

## Containers and Hierarchy

### Container Organization

Operators can be organized into containers to create logical groupings and avoid naming conflicts:

```
/                         (root)
├── data-loader           (root-level operator)
├── threshold             (root-level operator)
└── analysis/             (container)
    ├── filter1           (nested operator: /analysis/filter1)
    ├── processor         (nested operator: /analysis/processor)
    └── visualization/    (nested container)
        └── map-layer     (deeply nested: /analysis/visualization/map-layer)
```

### Path Benefits

- **No ID Conflicts**: Multiple operators can have the same base name in different containers
- **Logical Organization**: Group related operators together
- **Clear References**: Explicit paths show data flow relationships
- **Scalability**: Support for complex, hierarchical projects

### Container Operations

- **Moving Operators**: Drag operators between containers to reorganize
- **Path Updates**: References automatically update when operators move
- **Nested Containers**: Create containers within containers for complex organization

## Custom Operators

Create new operators by extending the base class:

```typescript
export class CustomOperator extends Operator<{
  input: DataField
  threshold: NumberField
}> {
  static displayName = 'Custom Processor'
  static description = 'Processes data with custom logic'

  constructor() {
    super({
      input: new DataField(),
      threshold: new NumberField({ min: 0, max: 100 })
    })
  }

  execute({ input, threshold }) {
    return input.filter(item => item.value > threshold)
  }
}
```
