import type { DeckProps, FirstPersonViewState, MapViewState } from '@deck.gl/core'
import type { IProject, ISheet } from '@theatre/core'
import type { RefObject } from 'react'

import type { MapProps } from 'react-map-gl/maplibre'
import type { CopyControlsRef } from './noodles/components/copy-controls'
import type { UndoRedoHandlerRef } from './noodles/components/UndoRedoHandler'

export type ViewState =
  | MapViewState
  | FirstPersonViewState
  | { [viewId: string]: MapViewState | FirstPersonViewState }

export type BetterMapProps = MapProps & MapViewState
export type BetterDeckProps = Partial<DeckProps & { viewState: ViewState }>

export type Visualization = {
  // Direct component props (no widgets wrapper)
  flowGraph?: React.ReactNode
  nodeSidebar?: React.ReactNode
  propertiesPanel?: React.ReactNode
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
  // Noodles props for creating menu in timeline-editor
  projectName?: string
  getTimelineJson?: () => Record<string, unknown>
  onSaveProject?: () => Promise<void>
  onDownload?: () => Promise<void>
  onNewProject?: () => Promise<void>
  onImport?: () => Promise<void>
  onOpen?: (projectName?: string) => Promise<void>
  onOpenAddNode?: () => void
  undoRedoRef?: RefObject<UndoRedoHandlerRef | null>
  copyControlsRef?: RefObject<CopyControlsRef | null>
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
  hasUnsavedChanges?: boolean
  // Visualization props
  mapProps?: BetterMapProps
  deckProps: BetterDeckProps
  project: IProject
  sheet: ISheet
}
