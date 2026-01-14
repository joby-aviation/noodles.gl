# Getting Started

Basic workflows for using Noodles.gl to create geospatial visualizations and animations.

> New to node-based workflows? Start with [Introduction to Workflows](./workflows-intro.md) to learn the fundamentals of how data flows through Noodles.gl.

## Interface Overview

### Node Editor
- **Add Operators**: Right-click an empty area of the canvas or press 'a' to open the operator menu
- **Connect Data**: Drag from output handles to input handles
- **Navigate**: Use breadcrumbs to move between containers, or press 'u' to go up one container level

### Properties Panel
- **Configure Inputs**: Adjust operator parameters
- **Reorder Fields**: Drag to change input order
- **Timeline Controls**: Keyframe values for animation

### Timeline Editor
- **Keyframes**: Click any parameter in property panel to add keyframes
- **Animation**: Use [Theatre.js timeline](https://www.theatrejs.com/docs/latest/manual/sequences#addingremoving-keyframes) for smooth motion
- **Playback**: Press 'space' to play animation

### Tools Shelf

The Tools Shelf in the top menu provides quick access to common operations:

| Tool | Description |
|------|-------------|
| **Add Node** | Opens the operator menu at canvas center |
| **Create Point** | Geocoding wizard to create a PointOp from an address or coordinates |
| **Import Data** | Import CSV/JSON files and auto-create a visualization pipeline |

#### Create Point Wizard
Search for locations by address or paste coordinates. The wizard uses multiple geocoding services with automatic fallback:
1. Google Places (if API key configured)
2. Mapbox (if API key configured)
3. Photon (free, no key required)

Creates a PointOp node with the selected coordinates.

#### Import Data
Drag-and-drop or browse for CSV/JSON files. The importer automatically creates a complete visualization pipeline including data source, layer, and map components. Files are saved to your project's data directory.

## Your First Project

**Data Source** → **Filter/Transform** → **Deck.gl Layer**

<iframe src="https://drive.google.com/file/d/13e933pV8w_NfLUlmXa1vEw8JB4KfmL4z/preview" width="800" height="460" allow="autoplay"></iframe>

1. **Load Data**: Start by adding a data source operator (JSON, CSV, or API)
2. **Add Visualization**: Connect your data to a Deck.gl layer operator
3. **Style & Configure**: Use the properties panel to customize appearance
4. **Animate**: [Add timeline keyframes](./animation-and-rendering.md) to create smooth animations
5. **Export**: Generate images, videos, or interactive applications

## API Keys Configuration

Access API key settings via the gear icon in the top menu bar.

### Key Sources

Keys are resolved in priority order:
1. **Browser** - Stored in localStorage, persists across sessions
2. **Project** - Saved in project file (if "Save in project" is enabled)
3. **Environment** - Set via environment variables

The first source with a valid key is used automatically.

### Supported Keys

| Key | Purpose | Required For |
|-----|---------|--------------|
| Mapbox Access Token | Basemaps, directions | MaplibreBasemapOp with Mapbox styles |
| Google Maps API Key | Places geocoding | Create Point wizard, DirectionsOp |
| Anthropic API Key | Claude AI assistant | AI chat features |

### Privacy

API keys are stored locally and never sent to Noodles.gl servers. Browser keys are stored in localStorage; project keys are stored in the project's noodles.json file.

### Environment Variables

For development or CI/CD, set keys via environment variables:
- `VITE_MAPBOX_ACCESS_TOKEN`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_CLAUDE_API_KEY`
