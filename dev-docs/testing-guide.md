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
- **Browser Tests**: For UI components in real browser environment with Playwright
- **Visual Regression Tests**: Screenshot comparisons to catch visual changes
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

# Update visual regression baselines
yarn test --update
```

## Browser Testing with Playwright Traces

Noodles.gl uses Vitest browser mode with Playwright for component and integration tests. Playwright traces are automatically captured for failed tests to help debug issues.

### What Are Traces?

Playwright traces are detailed recordings of test execution that include:
- Screenshots at each step
- Network requests and responses
- Console logs and errors
- DOM snapshots
- Test actions and timing

### Viewing Traces

When a test fails, traces are automatically saved to `.vitest-traces/` directory. To view a trace:

```bash
# View trace with Playwright trace viewer
npx playwright show-trace .vitest-traces/<trace-file>.zip

# Or upload to online viewer
# Visit https://trace.playwright.dev and drag the .zip file
```

The trace viewer provides:
- Timeline of all test actions
- Screenshots at each step
- Network activity
- Console logs
- Source code (if available)

### Trace Configuration

Traces are configured in `vitest.config.ts`:

```typescript
test: {
  browser: {
    trace: {
      mode: 'retain-on-failure',  // Only save traces for failed tests
      tracesDir: '.vitest-traces', // Where to save traces
      screenshots: true,           // Include screenshots
      snapshots: true,             // Include DOM snapshots
    },
  },
}
```

Available trace modes:
- `'retain-on-failure'` - Only failed tests (recommended for CI/local)
- `'on'` - All tests (useful for debugging specific issues)
- `'off'` - No traces

### Tips for Using Traces

1. **Debugging flaky tests**: Enable traces for all tests temporarily with `mode: 'on'`
2. **CI failures**: Download trace artifacts from GitHub Actions to debug CI-only failures
3. **Performance issues**: Use timeline view to identify slow operations
4. **Visual inspection**: Screenshots help identify visual/rendering bugs

## Visual Regression Testing

Visual regression tests capture screenshots and compare them against baseline images to detect unintended visual changes.

### Writing Visual Regression Tests

```typescript
import { expect, test } from 'vitest'
import { page } from '@vitest/browser/context'
import { render, screen } from '@testing-library/react'

test('component matches visual snapshot', async () => {
  render(<MyComponent />)
  
  // Wait for component to stabilize
  await page.waitForTimeout(100)
  
  // Compare against baseline
  const element = screen.getByTestId('my-element')
  await expect(element).toMatchScreenshot('my-component.png')
})
```

### Managing Baselines

```bash
# Update baselines after intentional visual changes
yarn test --update

# Or update specific test
yarn test my-component.visual.test.tsx -u
```

Baseline screenshots are stored in `__screenshots__` directories and should be committed to version control.

### Best Practices for Visual Tests

- **Wait for stability**: Use `page.waitForTimeout()` to ensure components finish rendering
- **Isolate tests**: Mock external dependencies to ensure consistent rendering
- **Name screenshots clearly**: Use descriptive names like `'examples-page-layout.png'`
- **Review changes carefully**: When updating baselines, verify changes are intentional
- **CI consistency**: Baselines may differ across OS/browsers; generate in same environment as CI

### When to Use Visual Tests

Use visual regression tests for:
- Critical UI paths (examples page, editor layout, timeline)
- Complex visualizations (maps, charts, graphs)
- Styling changes (themes, layout, responsive design)
- Components with many visual states

Avoid for:
- Fast-changing UI (frequently updated text/content)
- Dynamic data visualizations (use snapshot tests for data instead)
- Tests with high maintenance overhead

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
