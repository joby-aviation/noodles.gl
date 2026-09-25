import { BehaviorSubject, type Subscription } from 'rxjs'

import { DEFAULT_RENDER_SETTINGS } from '../noodles/utils/render-settings-constants'

export interface RenderSurfaceSize {
  width: number
  height: number
}

type ResizeObserverFactory = (
  callback: ResizeObserverCallback
) => Pick<ResizeObserver, 'observe' | 'disconnect'>

function isValidRenderSurfaceSize(size: RenderSurfaceSize): boolean {
  return [size.width, size.height].every(value => Number.isFinite(value) && value > 0)
}

export function calculateRenderSurfaceSize(
  resolution: RenderSurfaceSize,
  lod: number
): RenderSurfaceSize {
  return {
    width: Math.round(resolution.width * lod),
    height: Math.round(resolution.height * lod),
  }
}

const DEFAULT_RENDER_SURFACE_SIZE = calculateRenderSurfaceSize(
  DEFAULT_RENDER_SETTINGS.resolution,
  DEFAULT_RENDER_SETTINGS.lod
)

// Ambient render-surface size, published by the editor and read by operators that
// fit content to the output (see BoundingBoxOp). Mirrors the timeline context pattern:
// operators read the current value during execute() and subscribe to be marked dirty.
const sizeSubject = new BehaviorSubject<RenderSurfaceSize>(DEFAULT_RENDER_SURFACE_SIZE)

export function getRenderSurfaceSize(): RenderSurfaceSize {
  return sizeSubject.value
}

export function setRenderSurfaceSize(size: RenderSurfaceSize): void {
  if (!isValidRenderSurfaceSize(size)) return
  const current = sizeSubject.value
  if (current.width === size.width && current.height === size.height) return
  sizeSubject.next(size)
}

export function resetRenderSurfaceSize(): void {
  setRenderSurfaceSize(DEFAULT_RENDER_SURFACE_SIZE)
}

// Calls `listener` on every change after subscription; the current value is read
// directly during execution, so only later changes need to invalidate cached output.
export function subscribeToRenderSurfaceSize(listener: () => void): Subscription {
  let initial = true
  return sizeSubject.subscribe(() => {
    if (initial) {
      initial = false
      return
    }
    listener()
  })
}

export function observeRenderSurface(
  element: HTMLElement,
  listener: (size: RenderSurfaceSize) => void,
  createObserver: ResizeObserverFactory = callback => new ResizeObserver(callback)
): () => void {
  let previous: RenderSurfaceSize | undefined
  const publish = () => {
    const size = {
      width: element.clientWidth,
      height: element.clientHeight,
    }
    if (!isValidRenderSurfaceSize(size)) return
    if (previous?.width === size.width && previous.height === size.height) return
    previous = size
    listener(size)
  }

  publish()
  const observer = createObserver(publish)
  observer.observe(element)
  return () => observer.disconnect()
}
