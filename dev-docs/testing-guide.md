# Testing Guide

This guide covers testing strategy, best practices, and guidelines for the Noodles.gl project.

## When to Add Tests

### Always Add Tests For

- **New operators and core functionality**
- **Changes to critical components** (see list below)
- **Complex state management or hook modifications**
- **Bug fixes** to prevent regressions
- **Non-trivial utility functions**

### Test Types

- **Unit Tests**: For operator logic, pure functions, and utilities
- **Integration Tests**: For graph transformations, hook interactions, and data flow
- **Component Tests**: For React components with React Testing Library
- **E2E Tests**: For full user workflows with Playwright

## Critical Components Requiring Extra Scrutiny

These components are core to the application and require thorough testing and careful review:

### Core Node System

- [noodles-editor/src/noodles/operators.ts](../noodles-editor/src/noodles/operators.ts) - Operator registry and execution
- [noodles-editor/src/noodles/fields.ts](../noodles-editor/src/noodles/fields.ts) - Field system and validation
- [noodles-editor/src/noodles/noodles.tsx](../noodles-editor/src/noodles/noodles.tsx) - Main application orchestration

### State Management

- [noodles-editor/src/noodles/hooks/use-project-modifications.ts](../noodles-editor/src/noodles/hooks/use-project-modifications.ts) - Project state mutations
- [noodles-editor/src/noodles/storage.ts](../noodles-editor/src/noodles/storage.ts) - File system and persistence
- All custom hooks in [noodles-editor/src/noodles/hooks/](../noodles-editor/src/noodles/hooks/)

### Data Flow

- [noodles-editor/src/noodles/utils/path-utils.ts](../noodles-editor/src/noodles/utils/path-utils.ts) - Operator path resolution
- [noodles-editor/src/noodles/utils/serialization.ts](../noodles-editor/src/noodles/utils/serialization.ts) - Project save/load
- Graph transformation functions in [noodles.tsx](../noodles-editor/src/noodles/noodles.tsx)

### Animation & Timeline

- [noodles-editor/src/timeline-editor.tsx](../noodles-editor/src/timeline-editor.tsx) - Native timeline integration and keyframe management

## Testing Best Practices

### For Operators

```typescript
describe('CustomOperator', () => {
  it('should transform data correctly', () => {
    const op = new CustomOperator('/test-op')
    const result = op.execute({ data: testData, threshold: 50 })
    expect(result.output).toEqual(expectedOutput)
  })
})
```

### For React Hooks

```typescript
import { renderHook, act } from '@testing-library/react'

it('should update state correctly', () => {
  const { result } = renderHook(() => useCustomHook())
  act(() => {
    result.current.setValue(newValue)
  })
  expect(result.current.value).toBe(newValue)
})
```

### For Integration Tests

- Test operator connectivity and data flow through the graph
- Verify subscriptions are properly created and cleaned up
- Test that graph transformations match real application behavior
- Mock timeline state and other external dependencies appropriately

## Test Organization

- Co-locate unit tests with source files (`*.test.ts` alongside the file being tested)
- Integration and component tests can go in `__tests__` directories when they span multiple files
- Use descriptive test names that explain what is being tested
- Clean up resources in `afterEach` to prevent test pollution

## Running Tests

```bash
# Run all tests
cd noodles-editor && npm test

# Run specific test file
npm test src/noodles/operators.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run smoke tests (E2E rendering tests)
npm test smoke-test

# Run performance tests
npm test export-performance
```

## Testing Rendering and Video Export

The rendering pipeline is critical for video export performance. We have comprehensive tests to ensure the 8.6x speedup optimization (MapLibre render event vs onIdle) works correctly and doesn't regress.

### Smoke Tests

**File:** `noodles-editor/src/render/smoke-test.test.ts`

Validates basic rendering functionality:
- Loads example projects and creates operators
- Verifies connections between operators
- Tests MapLibre basemap integration
- Tests Deck.gl-only scenes (without basemap)

```bash
npm test smoke-test
```

**What these tests cover:**
- Project loading and operator instantiation
- Data connections and subscriptions
- Input value initialization
- Error handling for invalid operators

### Performance Tests

**File:** `noodles-editor/src/render/export-performance.test.ts`

Validates the render event optimization:
- EXPORT_FRAME_DELAY constant (16ms safety margin)
- Skip-first-render counter logic
- waitForData flag behavior
- frameCapturedRef guard (prevents double-capture)
- Performance targets and regression detection

```bash
npm test export-performance
```

**Key performance thresholds:**
- Frame capture time < 50ms per frame
- Total export time for 30 frames < 2 seconds
- Speed factor ≥ 0.5x realtime (target: 0.93x)
- Speedup vs old approach ≥ 6x (target: 8.6x)

### Performance Benchmarks

**Scripts:**
- `npm run benchmark:export` - Generate theoretical benchmark data
- `npm run benchmark:check` - Validate results against thresholds

**Output:** `benchmark-results.json` with timing data for CI tracking

**Benchmark scenarios:**
- Simple scene (icon-layer-test)
- Complex scene (3d-building-gradient)
- Variable captureDelay values (0ms, 25ms, 50ms, 100ms, 200ms)

**Example workflow:**
```bash
# Generate benchmark results
npm run benchmark:export

# Check if results meet thresholds
npm run benchmark:check
```

**Interpreting benchmark results:**
- `avgFrameTime`: Time per frame (lower is better, target <50ms)
- `speedFactor`: Realtime performance ratio (higher is better, target >0.5x)
- `waitPercent`: Percentage of time waiting for render (should be low with render event)

### Debugging Render Performance

Enable debug logging in browser console to see detailed timing:

```javascript
// In browser console
localStorage.debug = 'noodles:render*'

// Then reload and trigger export
// Check console for timing logs:
// - "onRender ready Xms after redraw (pass 2)" - render event timing
// - "onIdle fallback Xms after redraw" - fallback timing
```

**Common timing patterns:**
- **Good**: "onRender ready 36ms after redraw (pass 2)" → using render event, fast
- **Bad**: "onIdle fallback 350ms after redraw" → falling back to slow onIdle path

### What to Look For in Test Failures

**Smoke test failures:**
- Check if operators are registered in `opTypes`
- Verify edge connection format (sourceHandle/targetHandle)
- Ensure operator input fields exist and match project data

**Performance test failures:**
- Skip-first-render logic changed → update renderCountSinceRedraw tests
- EXPORT_FRAME_DELAY changed → update constant validation
- waitForData behavior changed → update layer loading tests

**Benchmark threshold failures:**
- Frame time > 50ms → performance regression, investigate bottleneck
- Speed factor < 0.5x → too slow, check if render event is working
- Speedup < 6x → optimization not effective, compare vs baseline

### Adding New Rendering Tests

When modifying the rendering pipeline:

1. **Add unit tests** for logic changes (e.g., new timing calculations)
2. **Update smoke tests** if operator behavior changes
3. **Add performance tests** for new optimization strategies
4. **Document expected timing** in test comments

**Example test structure:**
```typescript
it('should use new optimization strategy', () => {
  // Setup: Create mock scenario
  let optimizationApplied = false
  
  // Act: Simulate render flow
  const result = simulateRenderWithOptimization()
  
  // Assert: Verify optimization was applied
  expect(result.timingSaved).toBeGreaterThan(100)
  expect(optimizationApplied).toBe(true)
})
```

### Updating Performance Baselines

When intentional performance changes occur:

1. **Measure new baseline** using debug logging or Playwright
2. **Update thresholds** in `scripts/check-benchmark-thresholds.js`
3. **Update documentation** in test comments
4. **Document reason** in PR description

**When to update baselines:**
- Hardware upgrades (CI infrastructure changes)
- Major optimization improvements (new algorithm)
- Browser engine updates (WebGL/GPU changes)

**When NOT to update baselines:**
- Test failures without investigation
- Unexplained performance degradation
- Minor fluctuations (<10% variance)

## Test Runbooks for PRs

When creating pull requests, provide a manual test runbook to help reviewers verify changes in the UI.

### When to Provide a Test Runbook

- Feature additions or modifications to operators
- Bug fixes that affect user-visible behavior
- Changes to visualization or interaction behavior
- New integrations or data processing capabilities

### Runbook Best Practices

1. **Keep it simple**: Assume the app is already running - don't include setup steps
2. **Use real nodes**: Create a minimal graph with actual operators that demonstrates the feature
3. **Provide noodles.json**: Include a complete project file that reviewers can load directly
4. **Clear expected results**: State exactly what should happen at each step
5. **Test both cases**: Cover both success and edge cases (e.g., enabled/disabled, valid/invalid)

### Example Test Runbook Structure

```markdown
## Manual Testing in UI

1. **Create test graph:**
   - Add [Operator1] with value X
   - Add [Operator2] with value Y
   - Connect outputs to inputs

2. **Test primary behavior:**
   - Set parameter to A → should see result B
   - Set parameter to C → should see result D

3. **Test edge case:**
   - Disable feature → should see fallback behavior

4. **Verify in timeline:**
   - Keyframe parameter from X to Y
   - Should see [describe animation/interpolation]
```

### Include Project File

Provide a complete `noodles.json` file that can be saved in `noodles-editor/public/noodles/` and opened with `?project=test-name`. This makes it trivial for reviewers to verify the changes.

**Example:**

```json
{
  "version": 6,
  "nodes": [
    {
      "id": "/test-op",
      "type": "NumberOp",
      "position": {"x": 100, "y": 100},
      "data": {
        "inputs": {
          "value": 42
        }
      }
    }
  ],
  "edges": [],
  "viewport": {"x": 0, "y": 0, "zoom": 1},
    "timeline": {
    "sheetsById": {
      "Noodles": {
        "staticOverrides": {
          "byObject": {}
        }
      }
    },
    "definitionVersion": "0.4.0",
    "revisionHistory": []
  }
}
```

## When Modifying Critical Components

When changing files listed in "Critical Components Requiring Extra Scrutiny":

1. **Add tests first** if they don't exist
2. Make your changes
3. Ensure all existing tests pass
4. **Add new tests** for changed behavior
5. Consider integration tests for complex state changes
6. If the change is large, consider splitting into smaller PRs

---

**Last Updated**: 2025-12-01
