# Visual Regression Tests

This directory contains visual regression tests that capture screenshots and compare them to baseline images.

## Running Visual Tests

```bash
# Run all visual tests
yarn test src/**/*.visual.test.tsx

# Run specific visual test
yarn test src/examples-page.visual.test.tsx

# Update baselines (after intentional changes)
yarn test src/examples-page.visual.test.tsx -u
```

## Baseline Screenshots

Baseline screenshots are stored in two locations:
- `.vitest-attachments/src/` - Reference screenshots used for comparison
- `__screenshots__/` - Generated screenshots during test runs (next to test files)

Both directories should be committed to version control.

Example structure:
```
src/
  __screenshots__/
    examples-page.visual.test.tsx/
      examples-page-layout-chromium-linux.png
      examples-page-title-chromium-linux.png
.vitest-attachments/
  src/
    examples-page.visual.test.tsx/
      examples-page-layout-reference-chromium-linux.png
      examples-page-title-reference-chromium-linux.png
```

## Playwright Traces

When tests fail, Playwright traces are automatically saved to `.vitest-traces/` directory. These traces include:
- Screenshots at each step
- Network requests
- Console logs
- DOM snapshots
- Test actions and timing

### Viewing Traces

```bash
# View locally with Playwright trace viewer
npx playwright show-trace .vitest-traces/<trace-file>.zip

# Or upload to online viewer
# Visit https://trace.playwright.dev and drag the .zip file
```

The trace viewer provides a timeline of all test actions, making it easy to debug failures.

## Best Practices

1. **Review baselines carefully**: When updating with `-u`, always review the new screenshots to ensure changes are intentional
2. **Commit baselines**: Always commit baseline screenshots to version control
3. **CI consistency**: Baselines may differ across OS/browsers; generate in same environment as CI
4. **Use for critical paths**: Focus visual tests on important UI components that should remain stable
5. **Don't ignore traces**: Download and review traces when tests fail in CI

## See Also

- [Testing Guide](../../../dev-docs/testing-guide.md) - Complete testing documentation
- [Vitest Browser Mode](https://vitest.dev/guide/browser/) - Official Vitest browser mode docs
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) - Official trace viewer docs
