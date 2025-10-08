import type { ReactNode } from 'react'

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

export function TransformScale({ scale, children }: { scale: number; children: ReactNode }) {
  return (
    <div
      className="transform-scale"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      {children}
    </div>
  )
}
