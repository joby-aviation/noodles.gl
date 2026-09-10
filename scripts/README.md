# Noodles.gl Migration & Validation Scripts

Comprehensive tooling for migrating and validating example projects.

## Scripts

### `migrate-examples.js`

Applies migrations to all example projects and ensures proper node layout.

**Usage:**

```bash
# Migrate all examples to latest version
node scripts/migrate-examples.js

# Dry run (preview changes without writing)
node scripts/migrate-examples.js --dry-run

# Re-layout nodes without running migrations
node scripts/migrate-examples.js --layout-only
```

**Features:**

- Automatically loads and applies migrations from `__migrations__/` directory
- Topological layout algorithm positions nodes in readable horizontal flow
- Chains CreateAttributeOp nodes vertically with proper spacing
- Updates project version to target version (currently 15)
- Reports success/failure for each project

**Layout Configuration:**

- Horizontal spacing: 400px between layers
- Vertical spacing: 120px between chained nodes
- Chain start: (200, 100)

### `validate-examples.js`

Comprehensive validation of all example projects.

**Usage:**

```bash
# Validate all examples
node scripts/validate-examples.js

# Verbose mode (show stats for all projects)
node scripts/validate-examples.js --verbose
```

**Validation Checks:**

**Errors** (block PR):
- Invalid JSON
- Outdated version (< target)
- Missing/invalid node IDs or types
- Unknown operator types
- Deprecated operators (AccessorOp)
- Non-existent edge sources/targets
- Double-prefixed handles (`out.out.`, `par.par.`)
- Deprecated accessor field connections (`par.get*`)
- Invalid node positions
- Overlapping nodes

**Warnings** (advisory):
- Missing version field
- Missing data objects
- Missing handles
- Orphaned CreateAttributeOp (no input)
- Unused CreateAttributeOp (no output)
- Layer without data input
- Negative positions
- Very spread out layout
- Overlapping/close nodes

**Statistics:**
- Total nodes, edges
- CreateAttributeOp count
- AccessorOp count (should be 0 after migration)
- Layer count

## Migration System

### Migration 015: AccessorOp → CreateAttributeOp

Converts the old accessor-based pattern to attribute-based data flow.

**Before:**
```
Data -> AccessorOp(expression) -> Layer.getPosition
```

**After:**
```
Data -> CreateAttributeOp(name, expression, size, type) -> Layer.data
```

**Key improvements:**
1. **Deduplication** - One CreateAttributeOp per unique (accessor + data source)
2. **Type inference** - Automatically infers size and type from attribute names:
   - Position attributes: size 2 or 3 based on expression
   - Color attributes: size 4, type uint8
   - Scalar attributes: size 1
   - String attributes: outputType 'string'
3. **Chaining** - Multiple CreateAttributeOps chain together for same data source
4. **Layout** - Horizontal flow with vertical spacing for readability
5. **Edge migration** - Updates connections from accessor fields to data ports

**Skipped fields:**
- `getFilterValue` (DataFilterExtension - special semantics)
- Pass-through accessors (expression is just `"d"`)

**Test coverage:**
- 15 comprehensive tests
- Single/multiple accessors
- Color/position/scalar attributes
- Size/type inference
- Deduplication across layers
- Layout validation
- Edge migration

## Development

### Adding a New Migration

1. Create `noodles-editor/src/noodles/__migrations__/NNN-description.ts`:

```typescript
import type { NoodlesProjectJSON } from '../utils/serialization'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Transform project
  return project
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Optional downgrade (or return unchanged)
  return project
}
```

2. Add tests in `NNN-description.test.ts`

3. Update `TARGET_VERSION` in scripts

4. Run migration and validation scripts

### Testing

```bash
# Run migration tests
cd noodles-editor
npm test -- src/noodles/__migrations__/015-accessor-to-attribute.test.ts

# Run all tests
npm test
```

## CI/CD Integration

These scripts can be run in CI to ensure examples stay valid:

```yaml
- name: Validate examples
  run: node scripts/validate-examples.js
```

Exit codes:
- `0` - All valid
- `1` - Errors found

## Related Files

- `noodles-editor/src/noodles/__migrations__/` - Migration implementations
- `noodles-editor/src/examples/` - Example projects
- `noodles-editor/src/noodles/operators.ts` - Operator registry
- `noodles-editor/src/noodles/utils/serialization.ts` - Project schema

## Notes

- Migrations are **one-way** by default (down() often returns unchanged)
- Layout algorithm uses topological sort for clean horizontal flow
- Validation catches common migration errors (double-prefixed handles, etc.)
- All scripts are **idempotent** - safe to run multiple times
