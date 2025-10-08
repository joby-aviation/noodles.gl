# Project Architecture

Noodles.gl is a sophisticated node-based editor designed for creating geospatial visualizations and animations using Deck.gl. It emphasizes a balance between flexibility and rapid iteration, leveraging reactive data flow principles. It is a software that encourages toolbuilding and in-app extension to fit your needs.

The core concepts are based on Operators and Fields. At a high level, Operators comprise multiple Fields and an `execute` function. Fields are strongly typed and will react to incoming data changes. Fields and Operators can have custom React components that render in the node editor. In the future we might allow these to be created within the tool itself.

Noodles is powered by a reactive dataflow engine using rxjs and a keyframe-based timeline system powered by Theatre.js. It has a type system using Zod to make it easier to parse and accept arguments in multiple formats while allowing the operators to be flexible and composable.

Changes from the node editor propagate automatically through the dataflow graph, and any parameters can be keyframed on the timeline to create smooth animations. This makes it easy to create complex, data-driven animations with minimal effort.

## Directory Structure
```
noodles-editor/
├── src/                    # Source code
├── public/                 # Static assets and 3D models
├── dist/                   # Build output
├── vite.config.js          # Vite build configuration
├── tsconfig.json           # TypeScript configuration
├── biome.json              # Biome linter/formatter config
└── package.json            # Dependencies and scripts
```

## Source Code Organization (`src/`)

### Core Application Files

- `index.tsx` - Application entry point
- `App.tsx` - Root component (minimal wrapper)
- `TimelineEditor.tsx` - Timeline editor interface for orchestrating React with the rendering pipeline and Theatre.js
- `noodles.tsx` - Main visualization component that loads projects and manages state, and orchestrates nodes with React Flow
- `Operators.ts` - Registry of all available operators. Define new operators here.
- `Fields.ts` - Registry of all available fields. Define new fields here.
- `op-components.tsx` - React components for rendering operator nodes in the editor. Most operators use a default renderer but some have custom components defined here.
- `field-components.tsx` - React components for rendering field inputs in the node editor. Most fields use a default renderer but some have custom components defined here.

### Feature Modules (`src/features/`)

- `effects.ts` - Visual effects and animations

### Visualizations (`src/visualizations/noodles`)

- `nodes/` - Node editor components and logic

### Utilities (`src/utils/`)

- `color.ts` - Color manipulation utilities
- `distance.ts` - Geospatial distance calculations
- `arc-geometry.ts` - Arc geometry calculations
- `interpolate.ts` - Animation interpolation functions
- `map-styles.ts` - Map styling configurations
- `sheet-context.ts` - Theatre.js sheet context management
- `use-sheet-value.ts` - React hooks for Theatre.js values

### Rendering (`src/render/`)

- `renderer.ts` - Main rendering engine for saving to video or images
- `draw-loop.ts` - Animation frame management
- `transform-scale.tsx` - Coordinate transformation utilities

## Architecture Patterns

### Visualization System

- Visualizations return a `Visualization` object with:
  - `deckProps` - Deck.gl layer configuration
  - `mapProps` - MapLibre map settings
  - `widgets` - UI panel components

### Theatre.js Integration

- Projects are loaded dynamically based on URL parameters
- Each visualization has an associated Theatre.js sheet
- Animation state is managed through Theatre.js objects

### Component Organization

- Feature-based folder structure
- Shared utilities in dedicated utils folder
- Type definitions co-located with components
- CSS modules for component-specific styles

### Data Flow

- URL parameters determine visualization project
- Projects can have associated state files and data
- Real-time updates through Theatre.js timeline
- Reactive data processing with RxJS where needed
- Node-based operators for modular data transformations
- Type system using zod for validation, parsing, and transformation
