# Visual Regression Tests

End-to-end visual regression tests for all example projects using Playwright.

## Features

- **Dynamic Discovery**: Automatically finds all examples in `noodles-editor/src/examples/`
- **Animation Detection**: Procedurally detects animated examples by checking for keyframes
- **Visual Regression**: Screenshot comparison to catch rendering changes
- **CI-Ready**: Configurable for different environments

## Running Tests

### Run all tests

```bash
cd noodles-editor
npx playwright test examples-visual-regression
```

### Run single example

```bash
npx playwright test -g "nyc-taxis"
```

### Create/Update baseline snapshots

```bash
npx playwright test examples-visual-regression --update-snapshots
```

### Run with visible browser

```bash
npx playwright test examples-visual-regression --headed
```

## Configuration

### Environment Variables

- `PLAYWRIGHT_BASE_URL` - Override the base URL (default: `http://localhost:5173`)
  - When set, the dev server won't be started automatically
  - Useful for testing against a remote server or existing local instance

Example:
```bash
PLAYWRIGHT_BASE_URL=https://staging.example.com npx playwright test
```

### Test Behavior

- **Timeout**: 90 seconds per test (configurable in `playwright.config.ts`)
- **Workers**: Tests run in parallel by default, use `--workers=1` for sequential
- **Retries**: 2 retries on CI, 0 locally

## How It Works

1. **Discovery**: Scans `src/examples/` for directories with `noodles.json` files
2. **Animation Check**: Parses `noodles.json` to detect keyframes
3. **Navigation**: Loads each example in a browser
4. **Wait**: Waits for Deck.gl canvas and data loading (10 seconds)
5. **Screenshot**: Takes full viewport screenshot including both Deck.gl canvas and React Flow nodes
6. **Animation Frames**: For animated examples, tests additional frames at 0s, 0.5s, 1s, 2s

## Snapshots

Baseline snapshots are stored in:
```
src/__tests__/examples-visual-regression.spec.ts-snapshots/
```

**Snapshot Types:**
- `example-chromium-darwin.png` - Full viewport (Deck.gl canvas + React Flow nodes)
- `example-0s-chromium-darwin.png` - Animation frames at specific times (for animated examples)

**Important**: Baseline snapshots **are committed to git** so CI can compare against them. When you update snapshots locally, commit the changes so everyone has the same baseline.

**Note**: Snapshots are platform-specific (includes `-chromium-darwin` suffix). CI must run on the same platform to avoid false positives.

## Test Artifacts

The following are automatically ignored by git:
- `playwright-report/` - HTML test reports
- `test-results/` - Detailed test results and failure screenshots

**Committed to git:**
- `*-snapshots/` - Baseline screenshots for CI comparison

## Troubleshooting

### "Cannot navigate to invalid URL"

Make sure you're running from the `noodles-editor/` directory, not the repo root.

### "Test timeout"

Some examples (like `cesium-hubble`) load large external datasets and may timeout. This is expected for slow-loading examples.

### Snapshots don't match

Anti-aliasing and timing differences can cause minor pixel differences. The tests allow up to 100 pixels difference (`maxDiffPixels: 100`).

To accept new rendering:
```bash
npx playwright test examples-visual-regression --update-snapshots
```

## CI/CD Integration

For CI environments:

```bash
# Install dependencies
npm ci

# Install Playwright browsers
npx playwright install --with-deps chromium

# Run tests
npm test examples-visual-regression
```

Or use an external server:
```bash
PLAYWRIGHT_BASE_URL=http://localhost:5173 npx playwright test
```
