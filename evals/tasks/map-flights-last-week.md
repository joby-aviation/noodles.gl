---
id: map-flights-last-week
taskVersion: 1
family: authoring
tags: [authoring, data-source, filtering]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/flights-fixture.csv
      to: noodles-editor/src/examples/ny-flights/flights.csv
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/ny-flights/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/ny-flights/noodles.json
    custom: map-flights-last-week
    load:
      route: /examples/ny-flights
      screenshot: non-blank
      # Read each rendered layer's data in the loaded app (get_node_output
      # over WebMCP) so the filter is graded on what the map received.
      probeLayers: true
    requiredNodeTypes: [DeckRendererOp]
---

# map-flights-last-week

Data to map: a one-line ask that only works if the session reads the data
and filters it. The CSV is a **made-up fixture** (`fixtures/flights-fixture.csv`,
written by `fixtures/make-flights-fixture.ts`) standing in for the output of a
flight-data tool, which a real session would query itself. The prompt's
second paragraph is that stand-in: it says where the export landed and when
it was pulled, which is what a tool result would carry.

## Prompt (verbatim)

> Map of last week's New York Blade flights.
>
> Our flight-data tool isn't connected in this environment, so I exported its
> results for you: the last two weeks of flights, pulled Monday 2026-10-19,
> are in `noodles-editor/src/examples/ny-flights/flights.csv`. Build the map
> as a Noodles project at `noodles-editor/src/examples/ny-flights/noodles.json`
> so I can open it in the editor at `/examples/ny-flights`.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes.
2. Required node types: `DeckRendererOp`; custom: some `*LayerOp` reaches the
   renderer, and a basemap operator is present.
3. Loads under Playwright without console errors; screenshot non-blank.
4. Custom (`map-flights-last-week`), runtime: the layers wired to the renderer
   receive exactly the 12 target flights, read with `get_node_output` in the
   loaded app. Flights are identified by `FLT-####` ids, or, when the session
   dropped that column, by coordinate fingerprints (each flight's path bows by
   its own seeded amount).

## The fixture

577 position samples (every 30 s) for 24 flights, columns
`flight_id,operator,timestamp,lng,lat,alt_m,origin,destination`.

| Flights | Why they are there |
|---|---|
| 12 Blade flights, New York, 2026-10-12 to 10-18 | the target set |
| 6 Blade flights, New York, the week before | "last week" |
| 3 Blade flights, Nice to Monaco, last week | "New York" |
| 3 Joby flights last week, one of them JFK to JRA | "Blade" |

Every departure is between 12:00 and 23:00 UTC, so the UTC and New York
calendar days agree: a calendar week (Mon 10-12 to Sun 10-18) and a rolling
seven days before the Monday pull select the same flights.

## Notes

- `FileOp` parses CSVs with `d3.autoType` by default, which turns the ISO
  timestamps into `Date` objects. A filter that compares them to date strings
  silently drops every row; the golden converts first. Expect sessions to hit
  this.
- The target is "an exported map". At T0 the session has no app to export
  from, so the graded export is the project file plus the harness's own render.
  A live-app variant (T5) can require `capture_visualization` or
  `export_video`.
- The user's time target for this request is 10 minutes. The budget above
  matches the other authoring tasks; session duration is recorded either way.
