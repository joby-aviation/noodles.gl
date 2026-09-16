import type { CSSProperties, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

const FIT_PADDING_PX = 16

export function calculateFitScale(
  panelWidth: number,
  panelHeight: number,
  surfaceWidth: number,
  surfaceHeight: number
): number {
  return Math.min(
    (panelWidth - FIT_PADDING_PX) / surfaceWidth,
    (panelHeight - FIT_PADDING_PX) / surfaceHeight,
    1
  )
}

// Get CSS scale of an element, e.g. CSS transform: "scale(2)" returns { x: 2, y: 2 }
export function getTransformScaleFactor(target: Element): { x: number; y: number } {
  // Extract scale from computed styles
  const computedStyle = window.getComputedStyle(target)
  const transform = computedStyle.transform // e.g., "matrix(a, b, c, d, e, f)"

  let scaleX = 1
  let scaleY = 1

  if (transform !== 'none') {
    const matrix = transform.match(/matrix\(([^)]+)\)/)
    if (matrix) {
      const values = matrix[1].split(', ').map(parseFloat)
      scaleX = values[0] // 'a' in the matrix
      scaleY = values[3] // 'd' in the matrix
    }
  }

  return { x: scaleX, y: scaleY }
}

export function TransformScale({
  scale,
  scaleMode = 'manual',
  width,
  height,
  children,
}: {
  scale: number
  scaleMode?: 'fit' | 'manual'
  width?: number
  height?: number
  children?: ReactNode
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const isFit = scaleMode === 'fit'

  useLayoutEffect(() => {
    if (!isFit) return

    const stage = stageRef.current
    const surface = surfaceRef.current
    if (!stage || !surface) return

    const updateScale = () => {
      // client/offset dimensions are CSS layout boxes and exclude CSS transforms.
      const panelWidth = stage.clientWidth
      const panelHeight = stage.clientHeight
      const surfaceWidth = surface.offsetWidth
      const surfaceHeight = surface.offsetHeight
      if (panelWidth <= FIT_PADDING_PX || panelHeight <= FIT_PADDING_PX) return
      if (surfaceWidth <= 0 || surfaceHeight <= 0) return
      setFitScale(calculateFitScale(panelWidth, panelHeight, surfaceWidth, surfaceHeight))
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(stage)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [isFit])

  const stageStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    ...(isFit ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : undefined),
  }

  return (
    <div
      className="transform-scale-stage"
      data-scale-mode={scaleMode}
      ref={stageRef}
      style={stageStyle}
    >
      <div
        ref={surfaceRef}
        className="transform-scale"
        style={{
          flex: '0 0 auto',
          // DeckGL's root is absolutely positioned, so it does not contribute to
          // max-content sizing. Use the fixed render size when available so the
          // surface can be measured and centered around the entire canvas.
          width: width ?? 'max-content',
          height: height ?? 'max-content',
          transform: `scale(${isFit ? fitScale : scale})`,
          transformOrigin: isFit ? 'center center' : 'top left',
        }}
      >
        {children}
      </div>
    </div>
  )
}
