# Technology Stack

## Core Framework

- **React** with TypeScript
- **Vite** as build tool and dev server
- **npm** for package management
- ES modules throughout the codebase

## Key Libraries

### Animation & Timeline

- **Native Timeline System** - Custom animation timeline with bezier interpolation
- Located in `src/timeline/` - Zustand store, interpolation engine, React UI components

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
npm start           # Start development server
npm run build       # Build for production
npm run serve       # Preview production build
npm test            # Run unit tests

# Code Quality
npm run lint        # Run Biome linter
npm run fix-lint    # Auto-fix linting issues with Biome

# Testing
npm test            # Run Vitest unit tests
```
