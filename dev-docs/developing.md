# Development Commands

## Build & Test

- `yarn start` - Start development server
- `yarn build` - Build for production
- `yarn test` - Run all tests
- `yarn test src/visualizations/noodles/noodles.test.ts` - Run specific test file
- `yarn test -t "should transform graph"` - Run test with specific name

## Linting

- `yarn lint` - Run linter
- `yarn fix-lint` - Automatically fix linting issues

## Environment Variables
- Copy `.env.local.example` to `.env.local` and fill in required API keys (Google Maps, Mapbox, MapTiler, Cesium, etc.)

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
- **Styling**: Use CSS modules or styled-components for component-specific styles
- **State Management**: Use React context with custom hooks
- **Testing**: Use vitest with mock data and snapshots

## Project Structure

- Visualizations are composed of nodes with inputs/outputs
- Operators (Op) define the behavior of nodes
- React Flow used for node graph visualization
- TheatreJS used for animation timeline
