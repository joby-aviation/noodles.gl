import {
  FirstPersonView,
  type FirstPersonViewProps,
  _GlobeView as GlobeView,
  type GlobeViewProps,
  MapView,
  type MapViewProps,
  OrbitView,
  type OrbitViewProps,
  OrthographicView,
  type OrthographicViewProps,
  View,
} from '@deck.gl/core'
import type { DeckViewValue } from '../types'

export function instantiateDeckView(view: DeckViewValue): View {
  if (view instanceof View) return view

  const { type, ...props } = view
  switch (type) {
    case 'MapView':
      return new MapView(props as MapViewProps)
    case 'GlobeView':
      return new GlobeView(props as GlobeViewProps)
    case 'FirstPersonView':
      return new FirstPersonView(props as FirstPersonViewProps)
    case 'OrbitView':
      return new OrbitView(props as OrbitViewProps)
    case 'OrthographicView':
      return new OrthographicView(props as OrthographicViewProps)
  }
}
