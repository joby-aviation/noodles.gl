# Getting Started

Basic workflows for using Noodles.gl to create geospatial visualizations and animations.

## Interface Overview

### Node Editor
- **Add Operators**: Right-click or press 'a' to open the operator menu
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

## Your First Project

**Data Source** → **Filter/Transform** → **Deck.gl Layer**

<video controls autoplay="true" muted="true" width="100%" style={{maxWidth: '800px'}}>
  <source src="/img/first-project-walkthrough.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

1. **Load Data**: Start by adding a data source operator (JSON, CSV, or API)
2. **Add Visualization**: Connect your data to a Deck.gl layer operator
3. **Style & Configure**: Use the properties panel to customize appearance
4. **Animate**: [Add timeline keyframes](./animation-and-rendering.md) to create smooth animations
5. **Export**: Generate images, videos, or interactive applications
