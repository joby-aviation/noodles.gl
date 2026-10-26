// Measurements of the element the visualization renders into. TimelineEditor publishes
// these to the operator environment (see noodles/environment.ts).

export interface RenderSurfaceSize {
  width: number
  height: number
}

export interface RenderSurfacePoint {
  x: number
  y: number
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

// Convert a client-space position to unscaled surface pixels. The bounding rect includes
// CSS transforms (TransformScale) while offset dimensions don't, so their ratio is the scale.
export function toRenderSurfacePoint(
  element: HTMLElement,
  clientX: number,
  clientY: number
): RenderSurfacePoint {
  const rect = element.getBoundingClientRect()
  const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
  const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1
  return {
    x: (clientX - rect.left) / (scaleX || 1),
    y: (clientY - rect.top) / (scaleY || 1),
  }
}

// Report the pointer position relative to the render surface, anywhere in the window
export function observeRenderSurfacePointer(
  getElement: () => HTMLElement | null,
  listener: (point: RenderSurfacePoint) => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window
): () => void {
  const onMove = (event: MouseEvent) => {
    const element = getElement()
    if (element) listener(toRenderSurfacePoint(element, event.clientX, event.clientY))
  }
  target.addEventListener('mousemove', onMove)
  return () => target.removeEventListener('mousemove', onMove)
}
