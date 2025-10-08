# Paths and Containers

The Noodles.gl system uses fully qualified paths to uniquely identify operators and organize them into hierarchical containers.

## Path Fundamentals

### Path Format

All operators are identified by Unix-style absolute paths starting with `/`:

```
/operator-name              # Root level
/container/operator-name    # One level deep
/container/sub/operator     # Multiple levels
```

### Path Components

- **Root (`/`)**: All paths start from the project root
- **Containers**: Directory-like groupings (e.g., `/analysis/`)
- **Operator Name**: The final component (e.g., `filter1`)

## Container Hierarchy

### Organization Benefits

```
/                           # Project root
├── data-sources/          # Data loading container
│   ├── csv-loader
│   ├── json-loader
│   └── api-client
├── processing/            # Data processing container
│   ├── filter
│   ├── aggregator
│   └── transformer
└── visualization/         # Output container
    ├── map-layer
    ├── chart
    └── dashboard/         # Nested container
        ├── header
        └── controls
```

### Advantages

- **No Name Conflicts**: Multiple `filter` operators can exist in different containers
- **Logical Grouping**: Related operators stay together
- **Clear Dependencies**: Path references show data flow relationships
- **Scalability**: Support for complex, multi-level projects

## Path Resolution

### Absolute Paths

Start with `/` to specify the complete path from root:

```javascript
// Reference operators by absolute path
const data = op('/data-sources/csv-loader').out.value
const filtered = op('/processing/filter').out.value
const layer = op('/visualization/map-layer').out.value
```

### Relative Paths

Reference operators relative to the current operator's container:

```javascript
// From operator at '/processing/aggregator'

// Same container (these are equivalent)
const filtered = op('./filter').out.value
const filtered = op('filter').out.value

// Parent container
const data = op('../data-sources/csv-loader').out.value

// Nested path from current container
const chart = op('../visualization/dashboard/controls').out.value
```

### Resolution Examples

From operator at `/processing/transformer`:

| Reference              | Resolves To          | Description               |
| ---------------------- | -------------------- | ------------------------- |
| `/data-sources/csv`    | `/data-sources/csv`  | Absolute path             |
| `./filter`             | `/processing/filter` | Same container            |
| `filter`               | `/processing/filter` | Same container (implicit) |
| `../visualization/map` | `/visualization/map` | Parent then down          |
| `../../root-op`        | `/root-op`           | Multiple levels up        |

## Handle References

### Handle ID Format

Handles combine the operator path with field information:

```
operatorPath.namespace.fieldName
```

Examples:
```
/data-loader.out.data                    # Data output
/processing/filter.par.threshold         # Parameter input
/visualization/dashboard/chart.par.data  # Nested parameter
```

### Connection Examples

```javascript
// Connect using fully qualified handle IDs in the edges array
edges: [{
  id: '/data-loader.out.data->/processing/filter.par.input',
  source: '/data-loader',
  target: '/processing/filter',
  sourceHandle: '/data-loader.out.data',
  targetHandle: '/processing/filter.par.input',
}]
```

## Best Practices

### Naming Conventions

```javascript
// Good: Descriptive, hierarchical names
/data-sources/customer-csv
/processing/sales-filter
/visualization/revenue-chart

// Avoid: Generic names that might conflict
/data
/filter
/chart
```

### Container Organization

```javascript
// Good: Logical grouping
/data-sources/
/processing/
/visualization/
/utilities/

// Good: Feature-based grouping
/customer-analysis/
/sales-dashboard/
/reporting/
```

### Path References

```javascript
// Good: Use relative paths for related operators
const data = op('./data-source').out.value  // Same container
const config = op('../config').par.value    // Parent container

// Good: Use absolute paths for distant references
const globalConfig = op('/config/global').par.value
```

### Performance Considerations

- **Path Resolution**: Minimal overhead for path parsing
- **Caching**: Resolved paths are cached for performance
- **Memory**: Qualified paths use slightly more memory than simple IDs

## Troubleshooting

### Common Issues

**Path Not Found**
```javascript
// Check if path exists and is spelled correctly
const result = op('/processing/filtter')  // Typo: 'filtter'
// Returns undefined - check console for warnings
```

**Circular References**
```javascript
// Avoid circular path references
op('../container/./operator')  // Redundant path segments
```

**Container Boundaries**
```javascript
// Cannot navigate above root
op('../../../../../../operator')  // Resolves to undefined
```

### Debugging Tips

1. **Console Logging**: Check resolved paths in browser console
2. **Path Validation**: Verify paths exist before referencing
3. **Visual Inspection**: Use the node graph to trace connections
4. **Migration Logs**: Check for migration warnings on project load

## User Interface Features

### Breadcrumb Navigation

The system includes a breadcrumb component for navigating container hierarchies:

- **Visual Navigation**: Breadcrumbs show the current path (e.g., `root > processing > filters`)
- **Click Navigation**: Click any breadcrumb to navigate to that container level
- **Keyboard Navigation**: Press `u` key to navigate up one container level
- **Dropdown Menus**: Breadcrumbs include dropdowns showing available sub-containers

### Automatic ID Generation

The `nodeId()` function generates unique operator IDs within containers:

```javascript
// Generate unique IDs with automatic numbering
nodeId('filter', '/processing')     // → '/processing/filter'
nodeId('filter', '/processing')     // → '/processing/filter-1' (if filter exists)
nodeId('filter', '/processing')     // → '/processing/filter-2' (if filter-1 exists)
```

### Display Names

- **Node Headers**: Show only the base name (e.g., `filter` instead of `/processing/filter`)
- **Path Resolution**: Full paths used internally, display names used in UI
- **Container Indicators**: Visual cues show operator container membership

## Advanced Usage

### Dynamic Path Construction

```javascript
// Build paths programmatically
const containerName = 'processing'
const operatorName = 'filter'
const data = op(`/${containerName}/${operatorName}`).out.value
```

### Conditional References

```javascript
// Reference different operators based on conditions
const source = condition
  ? op('./primary-data').out.value
  : op('./fallback-data').out.value
```

### Path Utilities

```javascript
// Path manipulation utilities
const parentPath = getParentPath('/processing/filter')  // '/processing'
const baseName = getBaseName('/processing/filter')      // 'filter'
const qualified = generateQualifiedPath('filter', '/processing')  // '/processing/filter'

// Container relationship utilities
const isChild = isDirectChild('/container/operator', '/container')  // true
const isNested = isWithinContainer('/container/sub/op', '/container')  // true
const children = getDirectChildren('/container', opMap)  // Array of direct child operators
```

This path system provides a robust foundation for organizing complex node graphs while maintaining simplicity for basic use cases.
