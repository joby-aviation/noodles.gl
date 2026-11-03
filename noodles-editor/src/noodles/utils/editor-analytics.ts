// Analytics for editor chrome: panels shown and hidden, the AI assistant opened and closed,
// the map's layout, and the first time the user moves the map camera.
//
// Each helper is called from the control the user clicked (or, for panels resized by
// dragging, from the panel's resize transition), never from code that changes the same
// state on its own, such as opening the timeline for an animated project.

import type { MapMode } from '../../editor/ui-store'
import { analytics } from '../../utils/analytics'

export type ToggledPanel = 'sidebar' | 'properties' | 'timeline' | 'spreadsheet'

export function trackPanelToggled(panel: ToggledPanel, visible: boolean) {
  analytics.track('panel_toggled', { panel, visible })
}

// toolbar: the top bar's Assistant / Hide button. quick_start: the Quick Start dialog's
// AI path. panel: the chat panel's own close button.
export type ChatOpenSource = 'toolbar' | 'quick_start'
export type ChatCloseSource = 'toolbar' | 'panel'

export function trackChatOpened(source: ChatOpenSource) {
  analytics.track('chat_opened', { source })
}

export function trackChatClosed(source: ChatCloseSource) {
  analytics.track('chat_closed', { source })
}

export function trackMapModeChanged(mode: MapMode) {
  analytics.track('map_mode_changed', { mode })
}

// Tracks a panel's visibility from its resize callbacks, which also fire when the layout is
// restored. The first call only records the starting state; later calls send an event
// when visibility flips.
export function createPanelVisibilityTracker(panel: ToggledPanel) {
  let visible: boolean | null = null
  return (nextVisible: boolean) => {
    if (visible !== null && visible !== nextVisible) trackPanelToggled(panel, nextVisible)
    visible = nextVisible
  }
}

export type MapInteractionKind = 'pan' | 'zoom' | 'rotate'

const trackedMapInteractions = new Set<MapInteractionKind>()

// Sends map_interacted the first time per page load the user pans, zooms or rotates the map.
// Callers pass only user gestures (deck's controller interaction state, or MapLibre events
// that carry an originalEvent), so camera keyframes and fitBounds never count.
export function trackMapInteraction(kind: MapInteractionKind) {
  if (trackedMapInteractions.has(kind)) return
  trackedMapInteractions.add(kind)
  analytics.track('map_interacted', { kind })
}

interface DeckInteractionState {
  isPanning?: boolean
  isZooming?: boolean
  isRotating?: boolean
}

export function trackDeckInteraction(state: DeckInteractionState) {
  if (state.isPanning) trackMapInteraction('pan')
  if (state.isZooming) trackMapInteraction('zoom')
  if (state.isRotating) trackMapInteraction('rotate')
}

// MapLibre fires dragstart/zoomstart/rotatestart/pitchstart for camera animations too;
// only events caused by user input carry the DOM event that started them
export function trackMapLibreGesture(kind: MapInteractionKind, event: { originalEvent?: unknown }) {
  if (event.originalEvent) trackMapInteraction(kind)
}

// For tests
export function resetMapInteractionTracking() {
  trackedMapInteractions.clear()
}
