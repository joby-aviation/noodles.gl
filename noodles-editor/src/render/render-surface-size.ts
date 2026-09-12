import { BoundingBoxOp } from '../noodles/operators'

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

export function syncBoundingBoxViewportSize(
  operators: Iterable<unknown>,
  size: RenderSurfaceSize
): void {
  if (!isValidRenderSurfaceSize(size)) return

  for (const operator of operators) {
    if (!(operator instanceof BoundingBoxOp)) continue

    const current = operator.inputs.viewportSize.value
    if (current.x === size.width && current.y === size.height) continue
    operator.inputs.viewportSize.setValue({ x: size.width, y: size.height })
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
