---
sidebar_position: 1
sidebar_label: Start here
---

# Welcome to Noodles.gl

Noodles.gl is the animation studio for maps — a node-based editor for building cinematic geospatial visualizations, entirely in the browser.

<video autoPlay loop muted playsInline style={{width: '100%', borderRadius: '12px', marginBottom: '1.5rem'}}>
  <source src="/img/example-nyc-taxi-brushing.mp4" type="video/mp4" />
</video>

## Start here

The editor runs in your browser. There is nothing to install.

<OpenInEditor label="Open the editor">

Opens the start screen, where you can pick an example or start a new project.

</OpenInEditor>

### Start from an example

Each one opens with its data loaded. Change a value and the map updates.

<StartExamples />

### Bring your own data

Drop a CSV, GeoJSON, GeoParquet, Shapefile or PMTiles file on the start screen, or on the canvas of an open project. Noodles.gl finds the coordinate columns and puts your data on a map.

Once you are in the editor, [Editor Basics](./users/getting-started.md) explains the parts of the screen.

## What makes it different

Most map tools give you a static snapshot. Noodles gives you a **timeline**. Every parameter in your visualization — camera angle, layer opacity, data filter, color ramp, arc height — can be keyframed and animated with bezier interpolation.

The result: data-driven stories you can export as video, publish as interactive pages, or render as print-quality stills.

## What you can build

- **Cinematic route animations** — fly a camera along a path while trip data trails behind, with smooth easing and timed reveals
- **Temporal data stories** — scrub through years of earthquake activity, urban growth, or flight patterns with a single timeline
- **Live data dashboards** — wire a DuckDB SQL query to a map layer; the visualization updates reactively when inputs change
- **Publication renders** — export at any resolution (4K video, 300dpi stills) with 40+ GPU-accelerated layer types
- **Repeatable workflows** — every project is a portable JSON file you can version-control, share, and re-run on new data

## Who it's for

**Storytellers** who need motion — you have a dataset and a narrative, and static maps aren't enough.
**Visualization engineers** who want composability — wire up reactive pipelines instead of writing imperative rendering code.
**Data teams** publishing analysis — go from exploration (DuckDB query, scatter plot) to polished animated render without switching tools.
**Researchers** sharing results — hand someone a project file and they see exactly what you see.

## How it works

Noodles.gl uses a **pull-based reactive graph**: you connect operators (data sources, transforms, visualization layers) and the output updates automatically when any upstream input changes. There's no "run" button — changes propagate in real time.

![EV charging stations across the Pacific Northwest — live data loaded via DuckDB SQL](/img/example-chargemap.png)

The timeline editor lets you keyframe any parameter at any point in time. Scrub, preview, adjust curves, then export — the same workflow motion designers use in animation tools, applied to geospatial data.

## Next steps

- **<EditorLink>Open the editor →</EditorLink>**, or start from one of the [examples above](#start-from-an-example)
- **[Editor Basics →](./users/getting-started)**: the node editor, properties panel, timeline and tools shelf
- **[Framework Developers →](./developers/overview)**: extend Noodles.gl with custom operators and field types
