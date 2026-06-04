# Zero-Copy Data Flow - Improvement Plan

## Current State Analysis

### What Works ✅
- DuckDB returns Arrow tables natively
- Arrow tables can flow through the operator graph
- Binary attribute infrastructure exists
- All 30 layers accept binary attributes
- Type coercion helpers exist (`arrowGetColumnAsTypedArray`)

### What's Broken ❌

#### 1. SQL Compiler Materializes to JS (graph-integration.ts:97)
```typescript
// CURRENT - defeats zero-copy:
const jsArray = result.table.toArray().map((row: any) => ({ ...row }))
results.set(upstreamId, { data: jsArray, arrowTable: result.table })

// SHOULD BE:
results.set(upstreamId, { data: result.table, arrowTable: result.table })
```

**Impact**: 2-3ms overhead per 10K rows converting Arrow → JS

**Fix**: Pass Arrow table directly, let downstream operators handle it

---

#### 2. CreateAttributeOp Materializes Rows (operators.ts:4212)
```typescript
// CURRENT - converts entire table to JS objects:
if (isArrowTable(data)) {
  dataArray = arrowToRows(data)  // ❌ materializes all rows
  for (let i = 0; i < dataArray.length; i++) {
    const result = fn(dataArray[i], i, dataArray)  // ❌ per-row eval
  }
}

// SHOULD BE (for simple column access):
if (isArrowTable(data) && isSimpleColumnAccess(expression)) {
  // Extract column directly: "d.latitude" → get latitude column
  const columnName = extractColumnName(expression)
  const typedArray = arrowGetColumnAsTypedArray(data, columnName)
  return { data: { data, attributes: { [name]: { values: typedArray, size } } } }
}
```

**Impact**: Negates all zero-copy benefits - materializes entire dataset

**Fix**: Parse expression to detect simple column access, extract directly from Arrow

---

#### 3. Expression Evaluation is JS-Only
```typescript
const fn = fnWithSource(['d', 'i', 'data'], `return ${expression}`, this.id)
```

**Problem**: 
- `d.columnName` requires materializing each row
- Can't do columnar operations
- No vectorized compute

**Fix Options**:

**Option A: Smart Expression Parser (Quick Win)**
```typescript
// Detect patterns:
// - "d.columnName" → direct column extract
// - "d.lng" → column extract
// - "[d.lng, d.lat]" → multi-column extract
// - "[d.lng, d.lat, 0]" → multi-column + constant

function optimizeExpression(expression: string, arrowTable: Table) {
  // Pattern: "d.columnName"
  const singleColumn = /^d\.(\w+)$/.exec(expression)
  if (singleColumn) {
    return { type: 'column', name: singleColumn[1] }
  }
  
  // Pattern: "[d.col1, d.col2, d.col3]"
  const multiColumn = /^\[d\.(\w+),\s*d\.(\w+)(?:,\s*d\.(\w+))?\]$/.exec(expression)
  if (multiColumn) {
    return { type: 'multi-column', names: multiColumn.slice(1).filter(Boolean) }
  }
  
  // Fall back to JS eval
  return { type: 'js-eval' }
}
```

**Option B: SQL-Based Attribute Creation (Best)**
```typescript
// If data came from SQL, extend the query:
// Instead of:
//   SELECT * FROM data
//   → JS CreateAttributeOp extracts columns
// 
// Generate:
//   SELECT *, lng AS position_x, lat AS position_y FROM data
//   → Attributes already computed in DuckDB

// CreateAttributeOp detects upstream SQL chain and injects computed columns
```

---

## Implementation Priority

### Phase 1: Stop Converting to JS Arrays (High Impact, Low Risk)

**File**: `graph-integration.ts`

```typescript
// Remove lines 95-97, change to:
results.set(upstreamId, {
  operatorId: upstreamId,
  data: result.table,  // Pass Arrow directly
  arrowTable: result.table,
})
```

**Testing**: Run existing test suite - operators should handle Arrow tables gracefully

---

### Phase 2: Optimize CreateAttributeOp for Common Cases (High Impact, Medium Risk)

**File**: `operators.ts` - CreateAttributeOp

```typescript
execute({ data, name, expression, type, size }) {
  if (!data || !name) return { data }
  
  // Fast path: Arrow table + simple column access
  if (isArrowTable(data)) {
    const optimized = optimizeExpression(expression, data)
    
    if (optimized.type === 'column') {
      // Direct column extraction - ZERO COPY
      const column = arrowGetColumn(data, optimized.name)
      const typedArray = column.toArray() // Already typed array
      return {
        data: {
          data,
          attributes: {
            ...getExistingAttributes(data),
            [name]: { values: typedArray, size }
          }
        }
      }
    }
    
    if (optimized.type === 'multi-column') {
      // Extract multiple columns and interleave
      const arrays = optimized.names.map(n => arrowGetColumn(data, n).toArray())
      const interleaved = interleaveArrays(arrays)
      return {
        data: {
          data,
          attributes: {
            ...getExistingAttributes(data),
            [name]: { values: interleaved, size: arrays.length }
          }
        }
      }
    }
  }
  
  // Slow path: materialize and evaluate JS expression
  // (existing logic)
}
```

---

### Phase 3: SQL-Native Attribute Generation (Best Performance)

**Concept**: When CreateAttributeOp follows a SQL-compiled chain, push attribute computation into DuckDB.

**Example**:
```
DuckDbOp → FilterOp → CreateAttributeOp(position) → CreateAttributeOp(color) → ScatterplotLayerOp
```

**Current**: SQL compiles `DuckDbOp → FilterOp`, then JS computes attributes

**Optimized**: SQL generates:
```sql
SELECT 
  *,
  CAST(longitude AS FLOAT) AS __attr_position_0,
  CAST(latitude AS FLOAT) AS __attr_position_1,
  CAST(0 AS FLOAT) AS __attr_position_2,
  CAST(red AS UINT8) AS __attr_color_0,
  CAST(green AS UINT8) AS __attr_color_1,
  CAST(blue AS UINT8) AS __attr_color_2
FROM (...)
```

Result table has attribute columns already computed, CreateAttributeOp just extracts them.

---

## Expected Performance Gains

### Before (Current State)
```
DuckDB (Arrow) → toArray() [2-3ms] → JS array → CreateAttributeOp per-row eval [5-10ms]
  → TypedArray → GPU [1ms]
Total: ~10-15ms per 10K rows
```

### After Phase 1
```
DuckDB (Arrow) → CreateAttributeOp per-row eval [5-10ms] → TypedArray → GPU [1ms]
Total: ~7-11ms per 10K rows (2-3ms saved)
```

### After Phase 2
```
DuckDB (Arrow) → CreateAttributeOp column extract [0.1ms] → GPU [1ms]
Total: ~2ms per 10K rows (80% improvement)
```

### After Phase 3
```
DuckDB computes attributes → Arrow columns → GPU [1ms]
Total: ~1ms per 10K rows (90% improvement)
```

---

## Testing Strategy

1. **Phase 1**: Existing tests should pass (operators handle both Arrow and JS)
2. **Phase 2**: Add benchmark comparing optimized vs JS eval paths
3. **Phase 3**: E2E SQL compilation tests with attribute generation

---

## Migration Path

### Backwards Compatibility
- Keep JS eval fallback for complex expressions
- Detect and optimize common cases automatically
- No user-facing changes

### Rollout
1. Implement Phase 1 (remove toArray conversion)
2. Test with production workloads
3. Add Phase 2 optimization
4. Measure performance gains
5. Consider Phase 3 if worthwhile

---

## Additional Observations

### GraphCompiler vs SQL Compiler
Two different SQL compilation approaches exist:
1. **SQL Compiler** (sql-compiler/) - Template-based, CTE generation
2. **GraphCompiler** (graph-compiler.ts) - Fragment-based composition

**Question**: Should these be unified? GraphCompiler seems newer/cleaner but incomplete.

### Console.log Statements
CreateAttributeOp, DeckRendererOp, ScatterplotLayerOp all have debug console.logs. Should use debug namespace instead.

### Arrow Type Coercion in arrowGetColumnAsTypedArray
Lines 54-68 copy arrays instead of returning underlying buffer:
```typescript
const values = column.toArray()  // Copies to JS array
return new Float32Array(values)  // Copies again
```

Should be:
```typescript
// Return underlying buffer directly if types match
const data = column.data[0]  // First RecordBatch
return data.values  // Underlying TypedArray (zero-copy!)
```

---

## Summary

**Critical Finding**: We have all the infrastructure for zero-copy but we're not using it!

**Quick Wins**:
1. Remove `toArray()` in graph-integration.ts (1 line change, 2-3ms saved)
2. Optimize CreateAttributeOp for column access (50 lines, 80% improvement)

**Future Work**:
3. SQL-native attribute generation (complex, 90% improvement)
4. Unify SQL compilation approaches
5. Clean up debug logging

The architecture is solid, but implementation doesn't leverage it fully.
