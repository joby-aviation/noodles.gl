# Visual Regression Testing

This directory contains visual regression tests for critical UI paths in the Noodles.gl editor.

## Overview

Visual regression tests capture screenshots of the application and compare them against baseline images. This helps ensure that UI changes are intentional and don't break existing functionality.

## Running Visual Tests

### Run All Visual Tests

```bash
yarn test:visual
```

### Run Specific Visual Test File

```bash
yarn test src/__tests__/visual/node-editor.test.tsx
```

### Update Visual Baselines

When you intentionally change the UI, update the baselines:

```bash
yarn test:visual -u
```

### Run Tests in UI Mode

For easier debugging:

```bash
yarn test:ui
```

## Playwright Traces

When tests fail, Playwright generates trace files that contain a complete recording of the test execution. This makes debugging much easier.

### Viewing Traces

After a test failure, traces are saved to `test-results/traces/`. To view them:

```bash
yarn test:trace
```

Or open a specific trace file:

```bash
npx playwright show-trace test-results/traces/trace-*.zip
```

You can also upload trace files to the online viewer:
https://trace.playwright.dev

### Trace Configuration

Traces are automatically generated on test failures (configured in `vitest.config.ts` with `trace: 'on-first-retry'`).

## Test Files

- **`node-editor.test.tsx`** - Tests for the main node editor interface
- **`timeline-editor.test.tsx`** - Tests for the timeline/animation editor
- **`critical-paths.test.tsx`** - Tests for critical user workflows
- **`visual-test-utils.ts`** - Shared utilities for visual testing

## Writing New Visual Tests

1. Import the page object and utilities:

```typescript
import { page } from 'vitest/browser'
import { navigateToProject, waitForNodeGraph } from './visual-test-utils'
```

2. Navigate to your page and wait for it to load:

```typescript
await navigateToProject('example')
await waitForNodeGraph()
```

3. Take a screenshot:

```typescript
await expect(page).toHaveScreenshot('my-test-name')
```

4. For element-specific screenshots:

```typescript
await expect(page.locator('.my-selector')).toHaveScreenshot('my-element')
```

## Best Practices

1. **Wait for Stability**: Always wait for elements and animations to complete before taking screenshots
2. **Use Descriptive Names**: Screenshot names should clearly describe what is being tested
3. **Test Critical Paths**: Focus on user-facing features and workflows
4. **Keep Tests Fast**: Don't test every single UI state, focus on important ones
5. **Update Baselines Carefully**: Only update baselines when UI changes are intentional

## Troubleshooting

### Tests Fail with "No baseline found"

Run with `-u` flag to create initial baselines:

```bash
yarn test:visual -u
```

### Screenshots Differ Slightly

Some differences are expected (fonts, rendering, etc.). Review the diff carefully and update if the changes are intentional.

### Trace Files Not Generated

Ensure `trace: 'on-first-retry'` is set in `vitest.config.ts`. Traces are only generated when tests fail.

### Dev Server Not Running

Visual tests require the dev server to be running on `http://localhost:5173`. Start it with:

```bash
yarn start
```

## CI Integration

Visual tests run automatically in CI. When tests fail:

1. Download the trace files from CI artifacts
2. `npx playwright show-trace https://example.com/trace.zip` or upload to https://trace.playwright.dev to debug
3. Review screenshot diffs in CI output
4. Update baselines if changes are intentional

