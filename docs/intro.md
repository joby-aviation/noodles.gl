---
sidebar_position: 1
---

# Welcome to Noodles.gl

Noodles.gl is a node-based editor for building geospatial visualizations and animations that are ready to publish — in the browser, no install required.

<video autoPlay loop muted playsInline style={{width: '100%', borderRadius: '12px', marginBottom: '1.5rem'}}>
  <source src="/img/example-nyc-taxi-brushing.mp4" type="video/mp4" />
</video>

## What you can build

- **Animated route maps** — keyframe camera moves, layer opacity, and data filters to tell a story over time
- **Live data dashboards** — wire up a DuckDB SQL query to a map layer; the output updates as the inputs change
- **Publication-quality renders** — export frames at any resolution for print, video, or interactive web embeds
- **Repeatable workflows** — every project is a JSON file you can version, share, and re-run on new data

## Who uses it

**Visualization experts** creating presentation-ready graphics for stakeholders and publications.  
**Developers** prototyping new data products — faster to wire up a node graph than to write boilerplate.  
**Data scientists** exploring spatial data interactively before committing to a pipeline.  
**Research teams** publishing polished geospatial analysis with reproducible, shareable project files.

## How it works

Noodles.gl uses a **pull-based reactive graph**: you connect operators (data sources, transforms, visualization layers) and the output updates automatically when any upstream input changes. There's no "run" button — changes propagate in real time.

![EV charging stations across the Pacific Northwest — live data loaded via DuckDB SQL](/img/example-chargemap.png)

## Get started

- **[Application Users →](./users/getting-started)** — learn to load data, build graphs, and export visualizations
- **[Framework Developers →](./developers/overview)** — extend Noodles.gl with custom operators and field types
