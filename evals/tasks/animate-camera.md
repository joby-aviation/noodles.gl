---
id: animate-camera
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, animation]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/camera-tour.noodles.json
      to: noodles-editor/src/examples/camera-tour/noodles.json
  project: noodles-editor/src/examples/camera-tour/noodles.json
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/camera-tour/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/camera-tour/noodles.json
    custom: animate-camera
    load:
      route: /examples/camera-tour
      screenshot: non-blank
      # Animation tasks are graded on keyframes — capture with the timeline
      # panel expanded so the evidence shows them (capture environment, like
      # the 2K resolution; the graded surface is unchanged).
      openTimeline: true
---

# animate-camera

Animate the map camera via the timeline. Direct edits to the serialized
`timeline` JSON are a legitimate path (07 D2) — that's most of the challenge:
the structure is complex and only documented by example.

## Prompt (verbatim)

> In the camera-tour example
> (`noodles-editor/src/examples/camera-tour/noodles.json`), animate the camera
> so it flies from San Francisco to Los Angeles over 5 seconds.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes — including the timeline integrity
   rules (track paths resolve, keyframes sorted, unique ids).
2. Custom (`animate-camera`): longitude AND latitude tracks exist on a camera
   node (`viewState` prop paths, JSON-array or dot form); each has ≥ 2
   keyframes spanning ~0s → ~5s; endpoints ≈ SF (−122.42, 37.77) → ≈ LA
   (−118.24, 34.05) within ±0.5°; `sequence.length` covers the 5 seconds.
3. Loads under Playwright without console errors; screenshot non-blank.

## Notes

- The base project's camera starts at SF, so "from San Francisco" matches the
  initial `viewState`. `cesium-hubble` in the workspace is the only committed
  example with keyframed camera tracks — finding and imitating it is the
  realistic T0 path, and process metrics will show whether sessions did.
- Keyframe `position` is in seconds; `subUnitsPerUnit` is fps.
