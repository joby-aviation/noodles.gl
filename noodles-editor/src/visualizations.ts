import type { DeckProps, FirstPersonViewState, MapViewState } from '@deck.gl/core'
import type { RefObject } from 'react'

import type { MapProps } from 'react-map-gl/maplibre'
import type { CopyControlsRef } from './noodles/components/copy-controls'
import type { UndoRedoHandlerRef } from './noodles/components/UndoRedoHandler'
import type { GraphEdge } from './noodles/utils/map-camera-control'
import type { RenderSettings } from './noodles/utils/serialization'

export type ViewState =
  | MapViewState
  | FirstPersonViewState
  | { [viewId: string]: MapViewState | FirstPersonViewState }

export type BetterMapProps = MapProps & MapViewState
export type BetterDeckProps = Partial<DeckProps & { viewState: ViewState }>

export interface MapLibreLayerConfig {
  id: string
  type: 'custom'
  code: string
  renderingMode?: '2d' | '3d'
  beforeId?: string
  params?: Record<string, unknown>
}

export type Visualization = {
  // Direct component props (no widgets wrapper)
  flowGraph?: React.ReactNode
  nodeSidebar?: React.ReactNode
  propertiesPanel?: React.ReactNode
  showOverlay?: boolean
  onChangeShowOverlay?: (show: boolean) => void
  showDebugInfo?: boolean
  onChangeShowDebugInfo?: (show: boolean) => void
  autoLayoutOnConnect?: boolean
  onChangeAutoLayoutOnConnect?: (enabled: boolean) => void
  spreadsheetVisible?: boolean
  onChangeSpreadsheetVisible?: (visible: boolean) => void
  selectedNodeIds?: string[]
  // Every value edge in the project (all containers), for tracing what drives the view
  edges?: GraphEdge[]
  // Noodles props for creating menu in timeline-editor
  projectName?: string
  versionedProjectName?: string | null
  getTimelineJson?: () => Record<string, unknown>
  onSaveProject?: () => Promise<void>
  onSaveAs?: () => Promise<void>
  onRename?: () => void
  onDownload?: () => Promise<void>
  onNewProject?: () => Promise<void>
  onImport?: () => Promise<void>
  onOpen?: (projectName?: string) => Promise<void>
  onOpenAddNode?: () => void
  undoRedoRef?: RefObject<UndoRedoHandlerRef | null>
  copyControlsRef?: RefObject<CopyControlsRef | null>
  reactFlowRef?: RefObject<HTMLDivElement>
  showChatPanel?: boolean
  onChangeShowChatPanel?: (show: boolean) => void
  hasUnsavedChanges?: boolean
  // Render settings for video export
  renderSettings?: RenderSettings
  setRenderSettings?: (settings: RenderSettings) => void
  // Visualization props
  mapProps?: BetterMapProps
  deckProps: BetterDeckProps
  maplibreLayers?: MapLibreLayerConfig[]
}
