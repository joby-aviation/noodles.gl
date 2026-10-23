// Plain-object layers and widgets, as operators describe them, to deck.gl instances.

import type { Layer, LayerExtension, Widget } from '@deck.gl/core'
import * as deckWidgets from '@deck.gl/widgets'
import * as deck from 'deck.gl'
import { debugApp, debugVis } from '../../utils/debug'
import { extensionMap } from '../operators'
import {
  BitmapOverlayWidget,
  type BitmapOverlayWidgetProps,
} from '../widgets/bitmap-overlay-widget'
import { LegendWidget, type LegendWidgetProps } from '../widgets/legend-widget'

type Described = { type: string; [key: string]: unknown }

export function instantiateExtensions(extensions: unknown): LayerExtension[] | undefined {
  if (!extensions || !Array.isArray(extensions)) return undefined
  return extensions
    .map((ext: Described) => {
      const { type: extType, ...constructorArgs } = ext
      const extensionDef = extensionMap[extType]
      if (!extensionDef) {
        debugApp(`Unknown extension type: ${extType}`)
        return null
      }
      // A wrapped extension carries its class and constructor args
      if (typeof extensionDef === 'object' && 'ExtensionClass' in extensionDef) {
        return new extensionDef.ExtensionClass(extensionDef.args)
      }
      const ExtensionClass = extensionDef as new (...args: unknown[]) => LayerExtension
      return Object.keys(constructorArgs).length > 0
        ? new ExtensionClass(constructorArgs)
        : new ExtensionClass()
    })
    .filter((e): e is LayerExtension => e !== null)
}

/** A layer operator's output (`{type: 'ScatterplotLayer', ...props}`) as a deck.gl layer. */
export function instantiateLayer({ type, extensions, ...layer }: Described): Layer {
  const instantiatedExtensions = instantiateExtensions(extensions)
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: We intentionally support all deck.gl layer types dynamically
  const LayerClass = deck[type as keyof typeof deck] as unknown as new (
    props: Record<string, unknown>
  ) => Layer
  return new LayerClass({
    ...layer,
    ...(instantiatedExtensions ? { extensions: instantiatedExtensions } : {}),
    // Prevent deck.gl layer errors from crashing the GPU process
    onError: (e: Error) => {
      console.error(`[Noodles] Layer error in ${layer.id} (${type}):`, e)
      debugVis('Layer error in %s (id=%s): %o', type, layer.id, e)
    },
  })
}

export function instantiateWidget({ type, ...widget }: Described): Widget {
  if (type === 'LegendWidget') return new LegendWidget(widget as unknown as LegendWidgetProps)
  if (type === 'BitmapOverlay') {
    return new BitmapOverlayWidget(widget as unknown as BitmapOverlayWidgetProps)
  }
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: We intentionally support all deck.gl widget types dynamically
  const WidgetClass = deckWidgets[type as keyof typeof deckWidgets] as unknown as new (
    props: Record<string, unknown>
  ) => Widget
  return new WidgetClass(widget)
}
