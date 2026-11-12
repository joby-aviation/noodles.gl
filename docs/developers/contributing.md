# Contributing

Contributions are welcome: bug fixes, operators, documentation and tests. The full guide is [CONTRIBUTING.md](https://github.com/joby-aviation/noodles.gl/blob/main/CONTRIBUTING.md) in the repo; this page has the essentials.

## Before you start

- Search the [issues](https://github.com/joby-aviation/noodles.gl/issues) for related work, and open one before a large change.
- Fork the repo and work on a branch.
- Install with `npm ci` at the repo root, so you get the exact versions in the lockfile. The Node version is pinned in `.nvmrc`.

## Making a change

From `noodles-editor/`:

```bash
npm start          # dev server at http://localhost:5173/examples/nyc-taxis
npm test           # unit and browser tests
npm run fix-lint   # format and lint with Biome
```

- Add tests for new operators, bug fixes and changes to critical code. The [testing guide](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/testing-guide.md) covers where they go.
- An operator that replaces one from older projects needs a conversion and a test: see [Converting older projects](./framework-extension.md#converting-older-projects).
- Don't Biome-format `packages/planner`; it keeps its own style.
- Update the docs when behavior changes.

## Pull requests

- Keep each PR focused on one change.
- Fill in the [PR template](https://github.com/joby-aviation/noodles.gl/blob/main/.github/pull_request_template.md) as the [PR guidelines](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/pr-guidelines.md) describe.
- Attach a before and after screenshot or GIF for any UI change.
- Make sure CI passes: lint, tests and build.

By contributing, you agree that your contributions are licensed under the project's license, Apache 2.0.
