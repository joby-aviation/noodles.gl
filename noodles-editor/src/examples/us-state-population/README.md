# US State Population

2020 Census population by state, joined onto US state boundaries with ChoroplethLayer and ChoroplethJoin.

- `/population-choropleth` (ChoroplethLayer) joins `data.csv` to the built-in `us-states` boundaries on the `state` abbreviation column and colors each state by `population`.
- `/state-join` (ChoroplethJoin) does the same join without styling. Its FeatureCollection feeds `/state-centroids` (a CodeOp that takes `turf.centroid` of each state) and a text layer that labels each state.

Data: U.S. Census Bureau, 2020 Census resident population (50 states and DC).
