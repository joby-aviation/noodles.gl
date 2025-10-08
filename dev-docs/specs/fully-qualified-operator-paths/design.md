# Design Document

## Overview

This design implements a fully qualified path system for operators and handles in the nodes visualization system. The solution transforms the current flat ID structure into a hierarchical Unix-style path system that supports nested containers while maintaining backward compatibility through automatic migration.

## Architecture

### Path Structure

The system will use Unix-style absolute paths for all operator IDs:
- Root level operators: `/operatorName` (e.g., `/code1`, `/viewer1`)
- Nested operators: `/container/subcontainer/operatorName` (e.g., `/analysis/preprocessing/filter1`)
- Handle references: `/operatorPath.namespace.fieldName` (e.g., `/analysis/code1.par.data`)

### Core Components

1. **Path Resolution Engine**: Handles relative and absolute path resolution
2. **Enhanced getOp Function**: Modified to support path resolution with relative context
3. **Handle ID System**: Updated to use fully qualified paths for React Flow handles
4. **Migration Integration**: Extends existing migration system for path conversion

## Components and Interfaces

### Enhanced getOp Function

```typescript
// getOp function with path resolution - used in mustache and function references inside CodeOp
export const getOp = (
  path: string,
  contextOperatorId?: string
): Operator<IOperator> | undefined

// Usage examples:
getOp('/absolute/path/to/operator')           // Absolute path
getOp('./relative-operator', '/current/path') // Relative to context
getOp('../parent-operator', '/current/path')  // Parent relative
getOp('same-container-op', '/current/path')   // Same container (equivalent to './same-container-op')
```

### Path Resolution Engine

The path resolution engine uses Node.js `path.posix` utilities for robust Unix-style path handling:

```typescript
// Core path utilities from path-utils.ts
resolvePath('./operator', '/context/op')     // => '/context/operator'
resolvePath('../operator', '/context/op')    // => '/operator'
resolvePath('operator', '/context/op')       // => '/context/operator'

getParentPath('/container/operator')         // => '/container'
getBaseName('/container/operator')           // => 'operator'
isAbsolutePath('/container/operator')        // => true
normalizePath('/container/operator/')        // => '/container/operator'
isValidPath('/container/operator')           // => true

// Additional utilities
generateQualifiedPath('operator', '/container')  // => '/container/operator'
joinPath('/container', 'operator')               // => '/container/operator'
splitPath('/container/operator')                 // => ['/', 'container', 'operator']
```

## Data Models

### Operator Path Structure

```typescript
type OperatorPath = string // e.g., "/container1/subcontainer/operator1"
type HandlePath = string   // e.g., "/container1/subcontainer/operator1.par.data"
```


## Error Handling

### Path Resolution Errors

1. **Invalid Path Format**: Return undefined for malformed paths
2. **Circular References**: Detect and prevent infinite loops in relative path resolution
3. **Missing Operators**: Return undefined when referenced operator doesn't exist
4. **Container Boundary Violations**: Handle attempts to navigate above root level

### Migration Errors

1. **Corrupted Project Files**: Provide detailed error messages for unparseable files
2. **Conflicting IDs**: Generate unique IDs when migration would create conflicts
3. **Missing References**: Log warnings for unresolvable operator references
4. **Partial Migration**: Ensure atomic migration or rollback on failure

## Testing Strategy

### Unit Tests

1. **Path Resolution Tests**
   - Absolute path resolution
   - Relative path resolution (`./`, `../`)
   - Edge cases (root level, deep nesting)
   - Invalid path handling

2. **OpMap Tests**
   - Storage and retrieval with qualified paths
   - Container-based queries
   - Path updates and moves

3. **Handle ID Tests**
   - Generation of qualified handle IDs
   - Parsing of handle IDs back to components
   - React Flow integration

4. **Migration Tests**
   - Simple ID to qualified path conversion
   - Edge connection updates
   - Complex nested container scenarios
   - Error handling and rollback

### Integration Tests

1. **End-to-End Path Resolution**
   - Create operators in nested containers
   - Test cross-container references
   - Verify UI displays correct base names

2. **Migration Integration**
   - Load old format project files
   - Verify automatic migration
   - Test migrated project functionality

3. **React Flow Integration**
   - Test handle connections with qualified paths
   - Verify edge creation and deletion
   - Test container operations (move, delete)

4. **Component tests**
   - Renaming node updates handle ids
   - Deleting a node and mending connections should continue to work
   - Pasting conflicting node ids are de-conflicted in both the node and handles
   - Copying a container copies all nested content

### Performance Tests

1. **Path Resolution Performance**
   - Benchmark resolution with deep nesting
   - Test with large numbers of operators
   - Memory usage analysis

2. **Migration Performance**
   - Test migration of large project files
   - Measure migration time and memory usage

## Implementation Details

### Migration Strategy

1. **Detection**: Check for presence of operators with simple IDs (no `/` prefix)
2. **ID Mapping**: Create mapping from old IDs to new qualified paths
3. **Operator Updates**: Update all operator IDs to qualified paths
4. **Edge Updates**: Update all edge source/target references
5. **Handle Updates**: Update all handle IDs in edges
6. **Validation**: Verify all references are resolvable after migration

### Container Integration

The system will integrate with the existing `ContainerOp` by:
1. Using the container's ID as part of the path hierarchy
2. Updating child operator paths when containers are moved
3. Maintaining parent-child relationships in the path structure
4. Supporting nested containers through recursive path building

This design maintains backward compatibility while providing a robust foundation for hierarchical operator organization and eliminates the possibility of ID collisions across container boundaries.
