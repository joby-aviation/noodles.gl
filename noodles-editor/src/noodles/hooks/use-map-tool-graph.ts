import { useCallback } from 'react'
import { besideNetwork, commitBuilt } from '../../editor/doc-builder'
import { docStore } from '../../editor/doc-store'
import { drawingDoc, measurementDoc } from '../../editor/tool-docs'
import { debugUI } from '../../utils/debug'
import { type DrawFollowUp, featuresFor } from '../components/tools/draw-shapes'
import { type EditTarget, writeTargetFeatures } from '../components/tools/edit-target'
import { useMapToolStore } from '../components/tools/map-tool-store'
import type { LngLat } from '../components/tools/measure-math'

// Commits geometry produced by the on-map tools into the document: a Features node holding
// it, drawn in the deck (tool-docs.ts builds the nodes; this hook places and commits them).

function options() {
  const { doc, network } = docStore().get()
  return { doc, network, basePosition: besideNetwork(doc, network) }
}

export function useMapToolGraph() {
  const saveDrawing = useCallback((features: GeoJSON.Feature[]) => {
    if (features.length === 0) return
    const built = drawingDoc(options(), features)
    commitBuilt(docStore(), built)
    debugUI('Map tool wrote %d nodes to the document', built.nodes.length)
  }, [])

  const saveMeasurement = useCallback((points: LngLat[], closed: boolean) => {
    if (points.length < 2) return
    commitBuilt(docStore(), measurementDoc(options(), points, closed))
  }, [])

  // Writes the drawing as a Features node alone, then opens the follow-up's recipe with it
  // already wired in. The recipe's output gets the layer, not the raw drawing.
  const sendDrawingTo = useCallback((followUp: DrawFollowUp, features: GeoJSON.Feature[]) => {
    const relevant = featuresFor(followUp, features)
    if (relevant.length === 0) return
    const built = drawingDoc(options(), relevant, undefined, false)
    commitBuilt(docStore(), built)
    useMapToolStore.getState().requestRecipe({
      recipeId: followUp.recipeId,
      sources: { [followUp.shapeInput]: { source: built.primaryNodeId, sourceHandle: 'out' } },
    })
  }, [])

  // Writes edited shapes back to the node they came from, as one undo step. A write that
  // can't happen (the node is gone, or something now drives it) leaves no empty undo step.
  const saveEdits = useCallback((target: EditTarget, features: GeoJSON.Feature[]) => {
    const store = docStore()
    if (!writeTargetFeatures(structuredClone(store.get().doc), target, features)) return false
    store.edit(d => {
      writeTargetFeatures(d, target, features)
    })
    return true
  }, [])

  return { saveDrawing, saveMeasurement, sendDrawingTo, saveEdits }
}
