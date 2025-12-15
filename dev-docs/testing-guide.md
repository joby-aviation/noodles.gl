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

- [noodles-editor/src/timeline-editor.tsx](../noodles-editor/src/timeline-editor.tsx) - Theatre.js timeline integration and keyframe management

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
- Mock Theatre.js and other external dependencies appropriately

## Test Organization

- Co-locate unit tests with source files (`*.test.ts` alongside the file being tested)
- Integration and component tests can go in `__tests__` directories when they span multiple files
- Use descriptive test names that explain what is being tested
- Clean up resources in `afterEach` to prevent test pollution

## Running Tests

```bash
# Run all tests
cd noodles-editor && yarn test

# Run specific test file
yarn test src/noodles/operators.test.ts

# Run tests in watch mode
yarn test --watch

# Run tests with coverage
yarn test --coverage
```

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
