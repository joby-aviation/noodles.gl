# Development Guide

## Quick Start Commands

### Installation

```bash
# Install dependencies
yarn install:all

# Start development server
yarn start:app            # or cd noodles-editor && yarn start
```

### Development URLs

- **Local**: `http://localhost:5173/examples/nyc-taxis`
- **Specific Project**: Replace `nyc-taxis` with project name from `noodles-editor/public/examples/`
- **Safe Mode**: Add `?safeMode=true` to disable code execution

### Build & Test

```bash
# Run tests
cd noodles-editor && yarn test

# Run specific test file
yarn test src/visualizations/noodles/noodles.test.ts

# Run test with specific name
yarn test -t "should transform graph"

# Build for production
yarn build:all
```

### Linting & Formatting

```bash
# Run linter
cd noodles-editor && yarn lint

# Automatically fix linting issues
cd noodles-editor && yarn fix-lint

# Type checking
yarn typecheck
```

## Environment Setup

### Environment Variables

Copy `.env.local.example` to `.env.local` and fill in required API keys:

- Google Maps API key
- Mapbox API key
- MapTiler API key
- Cesium API key

### Development Tools

The project uses:

- **Biome** for fast linting and formatting (replaces ESLint/Prettier)
- **TypeScript** for type checking
- **Vitest** for unit testing
- **Playwright** for end-to-end testing

## Code Style Guidelines

- **TypeScript**: Use strict typing with detailed interfaces/types
- **Imports**: Group and sort imports (React, external libs, project imports, CSS). Use ESM imports instead of CJS
- **Components**: Use functional components with React hooks
- **Naming**:
  - PascalCase for components and classes
  - camelCase for variables and functions
  - Use descriptive names for operators (with 'Op' suffix)
- **Comments**: Use inline comments (`//`) for non-obvious code. Avoid jsdoc-style block comments (`/** */`) in favor of concise inline comments.
- **Async Functions**: Use async/await for async operations with try/catch for error handling
- **Side Effects**: Minimize side effects in functions, use hooks for managing state
- **Styling**: Use CSS modules for component-specific styles
- **State Management**: Use React context with custom hooks
- **Testing**: Use vitest with mock data and snapshots

## Best Practices

### Graph Design

- Minimize connections to reduce complexity
- Group related operations in containers
- Use descriptive node and field names
- Document complex transformations

### Performance

- Avoid deep graph nesting
- Batch related changes together
- Profile and optimize hot paths
- Use DuckDB for heavy data operations

### Code Quality

- Follow Biome configuration
- Write unit tests for operators
- Use TypeScript strictly
- Comment complex logic
- **Avoid `constructor.name`** - it gets minified in production builds. Use static `displayName`/`description` properties and access them via `(operator.constructor as typeof Operator).displayName`

### Maintenance

- Add migration scripts for schema changes
- Version control graph changes
- Keep documentation up-to-date
- Test operators in isolation

### Batching Updates

```typescript
// Batch multiple changes to avoid cascading updates
batch(() => {
  node1.fields.param1.setValue(value1)
  node2.fields.param2.setValue(value2)
})
```

## Project Structure

- Visualizations are composed of nodes with inputs/outputs
- Operators (Op) define the behavior of nodes
- React Flow used for node graph visualization
- TheatreJS used for animation timeline
