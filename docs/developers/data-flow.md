# Data Flow Architecture

The Noodles.gl system uses reactive programming principles to manage data flow through the node graph, ensuring efficient updates and consistent state.

## Reactive Programming Model

### RxJS Foundation

The system is built on RxJS observables for reactive data flow:

```typescript
field.setValue(value) // equivalent to field.next(field.schema.parse(value))

const value = field.value

// Listen to changes and re-render UI
field.subscribe(value => {
  // Update logic
})
```

### Data Flow Principles

1. **Unidirectional**: Data flows from outputs to inputs
2. **Reactive**: Changes propagate automatically
3. **Lazy**: Nodes only execute when upstream values change
4. **Memoized**: Results are cached to avoid recomputation

## Path Resolution System

### Operator Identification in project serialization

Operators are identified by fully qualified paths that reflect their container hierarchy:

```typescript
// Path examples
'/data-loader'                   // Root level operator
'/analysis/filter'               // Nested in analysis container
'/analysis/viz/scatter-plot'     // Deeply nested operator
```

### Handle Identification in project serialization

Handles (connection points) use the operator's full path plus field information:

```typescript
// Handle ID format: operatorPath.namespace.fieldName
'/analysis/processor.par.threshold'   // Parameter input
'/data-loader.out.data'               // Data output
'/viz/map.par.layers'                 // Nested operator parameter
```

### Path Resolution Rules in a `CodeField`

The system supports Unix-style path resolution for operator references:

```typescript
// From operator at '/analysis/processor'
op('/data-loader')       // Absolute: root level data-loader
op('./filter')           // Relative: /analysis/filter
op('../threshold')       // Parent: /threshold
op('normalizer')         // Same container: /analysis/normalizer
```

## Connection System

### Creating Connections

```typescript
// Connect nodes programmatically using fully qualified paths
sourceNode.fields.output.addConnection(
  '/analysis/processor',  // target operator path
  targetNode.fields.input
)
```

### Connection Lifecycle

1. **Validation**: Check type compatibility
2. **Subscription**: Set up reactive subscription
3. **Data Flow**: Values flow from source to target
4. **Cleanup**: Remove subscriptions when disconnected

### Connection Rules

- **Type Safety**: Zod schemas ensure type compatibility
- **Single Input**: Each input accepts one connection
- **Multiple Outputs**: Outputs can connect to many inputs
- **Cycle Detection**: Prevents circular dependencies

## Execution Model

### Operator Execution

```typescript
class Operator {
  execute(inputs: InputType): OutputType {
    // Pure function transformation
    return processInputs(inputs)
  }
}
```

### Execution Triggers

- **Input Changes**: When connected field values update
- **Parameter Changes**: When operator parameters change
- **Manual Trigger**: Explicit re-execution requests

### Execution Order

1. **Topological Sort**: Determine execution order
2. **Dependency Resolution**: Execute upstream nodes first
3. **Parallel Execution**: Independent branches run concurrently
4. **Result Propagation**: Outputs trigger downstream execution

## Memoization Strategy

### Automatic Caching

```typescript
// Results cached based on input hash
const cachedResult = memoize(operator.execute, inputs)
```

### Cache Invalidation

- **Input Changes**: Clear cache when inputs change
- **Parameter Updates**: Invalidate on configuration changes
- **Manual Clearing**: Explicit cache clearing for debugging

### Memory Management

- **LRU Eviction**: Remove least recently used results
- **Size Limits**: Prevent unbounded cache growth
- **Weak References**: Allow garbage collection

## Performance Optimization

### Batching Updates

```typescript
// Batch multiple changes to avoid cascading updates
batch(() => {
  node1.fields.param1.setValue(value1)
  node2.fields.param2.setValue(value2)
})
```

### Debouncing

```typescript
// Debounce rapid changes to reduce computation
field.pipe(
  debounceTime(100),
  distinctUntilChanged()
).subscribe(value => {
  // Process debounced value
})
```

### Selective Updates

- **Change Detection**: Only update when values actually change
- **Shallow Comparison**: Use object references for arrays/objects
- **Dirty Tracking**: Mark nodes that need re-execution

## Error Handling

### Error Propagation

```typescript
try {
  const result = operator.execute(inputs)
  field.next(result)
} catch (error) {
  field.error(error)  // Propagate error downstream
}
```

### Error Recovery

- **Graceful Degradation**: Continue execution with partial data
- **Default Values**: Fall back to safe defaults
- **Error Boundaries**: Isolate errors to prevent cascade failures

### Debugging Support

- **Execution Tracing**: Track data flow through graph
- **Performance Profiling**: Measure execution times
- **State Inspection**: Examine intermediate values

## Integration Points

### Theatre.js Timeline

```typescript
// Keyframe field values over time using fully qualified paths
const animatedValue = useSheetValue(
  sheet.object('/node', '/analysis/processor').props.fieldName,
  defaultValue
)
```

### Deck.gl Rendering

```typescript
// Connect node outputs to Deck.gl layers
const layers = nodeGraph.getLayerNodes().map(node =>
  node.execute(inputs)
)
```

### External Data Sources

```typescript
// Reactive data loading
const dataStream = fromFetch('/api/data').pipe(
  map(response => response.json()),
  catchError(error => of(fallbackData))
)
```

## Best Practices

### Graph Design

- **Minimize Connections**: Reduce complexity where possible
- **Logical Grouping**: Group related operations
- **Clear Naming**: Use descriptive node and field names
- **Documentation**: Comment complex data transformations

### Performance

- **Avoid Deep Graphs**: Limit nesting depth
- **Batch Operations**: Group related changes
- **Profile Bottlenecks**: Identify slow operations
- **Optimize Hot Paths**: Focus on frequently executed nodes

### Debugging

- **Incremental Building**: Test small graph sections
- **Data Inspection**: Examine intermediate results
- **Error Logging**: Capture and log execution errors
- **Visual Debugging**: Use graph visualization tools

### Maintenance

- **Version Control**: Track graph changes
- **Migration Scripts**: Handle schema updates
- **Testing**: Unit test individual operators
- **Documentation**: Maintain up-to-date docs
