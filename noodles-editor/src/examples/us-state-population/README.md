# US State Population

2020 Census population by state, joined onto US state boundaries with a Choropleth Layer and a Choropleth Join.

- `/population-choropleth` (Choropleth Layer) joins `state-data` (`@/data.csv`) to the built-in `us-states` boundaries, matching the `state` column to `abbrev`, and colors each state by `population` with the `blues` scheme.
- `/state-join` (Choropleth Join) does the same join without styling. `/state-centroids` (Code) takes `turf.centroid` of each state, `/label-text` (DuckDB SQL) writes a `label` such as `CA 39.5M`, and `/labels` (Text Layer) draws it.

```
state-data → population-choropleth → deck
           → state-join → state-centroids → label-text → labels → deck
```

Data: U.S. Census Bureau, 2020 Census resident population (50 states and DC).
