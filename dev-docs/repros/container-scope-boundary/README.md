# Repro: Container Scope Boundary Bugs

**File:** `container-scope-boundary.json`

**PR:** #503 — fix: container scope-boundary bugs (copy-paste, delete cascade, undo/redo)

## Setup

1. Copy `container-scope-boundary.json` into `noodles-editor/public/noodles/`
2. Start the dev server: `cd noodles-editor && npm start`
3. Open: `http://localhost:5173/noodles/container-scope-boundary`

## Graph Structure

```
/source (NumberOp: 42)
  └─> /container (ContainerOp)
        ├── /container/graph-input (GraphInputOp)
        ├── /container/math (MathOp: multiply by 2)
        ├── /container/graph-output (GraphOutputOp)
        └── /container/nested (ContainerOp)
              ├── /container/nested/graph-input
              ├── /container/nested/number (NumberOp: 7)
              └── /container/nested/graph-output
  └─> /sink (MathOp: add 0)
```

The container has 4 direct children and a nested container with 3 more. At root scope, only `/source`, `/container`, and `/sink` are visible in the canvas.

## Test Scenarios

### 1. Copy-Paste (was: children silently dropped)

1. At root scope, select `/container`
2. Cmd+C, then Cmd+V
3. **Expected:** A new container appears with ALL children (graph-input, math, graph-output, nested container + its children). Double-click the pasted container to verify its internals are intact.
4. **Bug (before fix):** Pasted container was empty — children were not copied because they live in a different scope.

### 2. Delete Cascade (was: orphaned children remained)

1. At root scope, select `/container`
2. Press Delete
3. **Expected:** The container AND all its children (including nested) are removed. No orphaned nodes remain in the graph.
4. **Bug (before fix):** Only `/container` was removed. Children like `/container/math` remained in the graph state with no parent, causing stale operator references.

### 3. Undo After Delete (was: children not restored)

1. Perform scenario 2 (delete the container)
2. Cmd+Z to undo
3. **Expected:** The container AND all its children are restored. Double-click the restored container to verify internals are intact.
4. **Bug (before fix):** Only `/container` was restored because the undo snapshot only captured displayed nodes (root scope), not the full graph.

### 4. Nested Container Cascade

1. Double-click `/container` to enter its scope
2. Select `/container/nested`
3. Press Delete
4. **Expected:** The nested container and its 3 children are removed
5. Cmd+Z to undo — all 4 nodes should come back

## What to Look For

- After any operation, open browser devtools and run:
  ```js
  // Check for orphaned children (should be empty array)
  const nodes = document.querySelector('.react-flow')?.__reactFiber$?.return?.memoizedProps?.nodes || []
  // Or check the operator store via debug logging:
  localStorage.debug = 'noodles:history*'
  ```
- The key invariant: every node whose ID contains a `/` prefix of another node should have that parent present in the graph. If it doesn't, something broke.
