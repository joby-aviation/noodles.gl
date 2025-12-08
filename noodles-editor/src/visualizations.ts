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
  // Direct component props (no widgets wrapper)
  flowGraph?: React.ReactNode
  projectNameBar?: React.ReactNode
  nodeSidebar?: React.ReactNode
  propertiesPanel?: React.ReactNode
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
  // Noodles props for creating menu in timeline-editor
  projectName?: string
  setProjectName?: (name: React.SetStateAction<string | null>) => void
  getTimelineJson?: () => Record<string, unknown>
  loadProjectFile?: (project: any, name?: string) => void
  undoRedo?: {
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    getState: () => { undoDescription?: string; redoDescription?: string }
  } | null
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
  // Visualization props
  mapProps?: BetterMapProps
  deckProps: BetterDeckProps
  project: IProject
  sheet: ISheet
}
