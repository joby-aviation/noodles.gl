---
id: t3-add-heatmap
taskVersion: 1
family: build
tier: T3
tags: [heatmap, existing-project]
start: nyc-taxis
budget:
  maxTurns: 12
  maxWallClockSeconds: 420
grader:
  checks:
    - type: nodeTypesPresent
      types: [HeatmapLayerOp]
    - { type: edgeExists, source: /data-source, targetType: HeatmapLayerOp, targetHandle: par.data }
    # Reusing the existing accessor or writing a new one both count
    - { type: edgeExists, sourceType: AccessorOp, targetType: HeatmapLayerOp, targetHandle: par.getPosition }
    - { type: edgeExists, sourceType: HeatmapLayerOp, target: /deck, targetHandle: par.layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewOperatorErrors
---

Add a heatmap of the pickup locations alongside the existing layers.
