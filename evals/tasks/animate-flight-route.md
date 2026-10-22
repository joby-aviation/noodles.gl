---
id: animate-flight-route
taskVersion: 1
family: authoring
tags: [authoring, data-source, animation]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/flights-fixture.csv
      to: noodles-editor/src/examples/flight-route/flights.csv
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/flight-route/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/flight-route/noodles.json
    custom: animate-flight-route
    load:
      route: /examples/flight-route
      screenshot: non-blank
      probeLayers: true
    requiredNodeTypes: [TripsLayerOp, DeckRendererOp]
---

# animate-flight-route

One flight from the same made-up export (`fixtures/flights-fixture.csv`, see
`map-flights-last-week`), drawn as a route that animates along its path, with
a speed the user can change.

## Prompt (verbatim)

> Using the flight export at `noodles-editor/src/examples/flight-route/flights.csv`,
> show flight FLT-1018 (West 30th Street to East Hampton on 2026-10-16) as an
> animated route that draws itself along the flight path, and give me a
> control to adjust the playback speed. Save it as a Noodles project at
> `noodles-editor/src/examples/flight-route/noodles.json` so I can open it at
> `/examples/flight-route`.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes; `TripsLayerOp` and `DeckRendererOp`
   present.
2. Loads under Playwright without console errors; screenshot non-blank.
3. Custom (`animate-flight-route`):
   - `current-time-animated`: `currentTime` depends on a `TimeOp` or on a
     keyframed node (edges, `op()` references, and container children all
     count as dependencies).
   - `speed-control-feeds-current-time`: a node (or promoted container
     parameter) named like a speed control (`speed`, `playback`, `duration`,
     `multiplier`, ...) is upstream of `currentTime`.
   - `timestamps-wired`: an explicit `getTimestamps` accessor, or a
     `timestamps` array in the layer's data (the layer's default accessor
     reads `d.timestamps`).
   - `trips-layer-gets-only-the-flight` (runtime probe): the TripsLayer
     receives FLT-1018 and no other flight.

## Notes

- The app has no saved or on-screen playback-speed setting (the timeline
  store's `playbackSpeed` is internal), so the speed control has to live in
  the graph. That is why the check looks upstream of `currentTime` rather
  than at the timeline.
- `world-flights` is the only committed example with a TripsLayer (a
  keyframed `NumberOp` drives `currentTime`). Finding and adapting it is the
  realistic T0 path; it has no speed control.
- Timestamps are ISO strings that `FileOp`'s default `autoType` turns into
  `Date` objects; TripsLayer needs numbers.
- The user's time target for this request is 15 minutes.
