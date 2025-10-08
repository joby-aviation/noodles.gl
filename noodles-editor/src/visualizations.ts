import type { DeckProps, FirstPersonViewState, MapViewState } from '@deck.gl/core'
import type { IProject, ISheet } from '@theatre/core'

import type { MapProps } from 'react-map-gl/maplibre'

export type ViewState =
  | MapViewState
  | FirstPersonViewState
  | { [viewId: string]: MapViewState | FirstPersonViewState }

export type BetterMapProps = MapProps & MapViewState
export type BetterDeckProps = Partial<DeckProps & { viewState: ViewState }>

export type Visualization = {
  widgets?: {
    flowGraph?: React.ReactNode
    right?: React.ReactNode // primary vertical panel for widgets
    bottom?: React.ReactNode // primary horizontal panel for widgets
    top?: React.ReactNode
    left?: React.ReactNode
  }
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
  mapProps?: BetterMapProps
  deckProps: BetterDeckProps
  project: IProject
  sheet: ISheet
}
