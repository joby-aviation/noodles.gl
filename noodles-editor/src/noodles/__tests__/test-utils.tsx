import { type RenderOptions, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'

export function ReactFlowTestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100vw', height: '100vh' }}>{children}</div>
    </ReactFlowProvider>
  )
}

export function NoodlesTestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100vw', height: '100vh' }}>{children}</div>
    </ReactFlowProvider>
  )
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, {
    wrapper: ReactFlowTestWrapper,
    ...options,
  })
}

export function renderWithNoodlesProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, {
    wrapper: NoodlesTestWrapper,
    ...options,
  })
}
