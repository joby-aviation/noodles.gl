# Technology Stack

## Core Framework

- **React** with TypeScript
- **Vite** as build tool and dev server
- **Yarn** for package management
- ES modules throughout the codebase

## Key Libraries

### Animation & Timeline

- **Theatre.js** - Animation timeline editor and runtime
- **@theatre/core**, **@theatre/react**, **@theatre/studio** - Core animation system

### Visualization & Mapping

- **Deck.gl** - WebGL-powered data visualization framework
- **MapLibre GL** - Open-source mapping library
- **luma.gl** - WebGL rendering engine (version 8.x)
- **D3.js** - Data manipulation and visualization utilities

### Geospatial & Data Processing

- **@turf/turf** - Geospatial analysis library
- **H3-js** - Hexagonal hierarchical geospatial indexing
- **@duckdb/duckdb-wasm** - In-browser analytical database
- **Apache Arrow** - Columnar data format

### UI Components

- **Radix UI** - Accessible component primitives
- **PrimeReact** - Rich UI component library
- **@xyflow/react** - Node-based editor components

## Dataflow

- **RxJS** - Reactive programming utilities

## Development Tools

### Code Quality

- **Biome** - Fast linter and formatter (replaces ESLint/Prettier)
- **TypeScript** - Type checking and compilation
- **Vitest** - Unit testing framework
- **Playwright** - End-to-end testing

### Build Configuration

- **Vite** with React plugin and Node.js polyfills
- **vite-plugin-node-polyfills** - Browser compatibility for Node.js APIs

## Common Commands

```bash
# Development
yarn start          # Start development server
yarn build          # Build for production
yarn serve          # Preview production build
yarn test           # Run unit tests

# Code Quality
yarn lint           # Run Biome linter
yarn fix-lint       # Auto-fix linting issues with Biome

# Testing
yarn test           # Run Vitest unit tests
```
