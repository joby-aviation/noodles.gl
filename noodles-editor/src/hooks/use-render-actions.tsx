import { createContext, useContext, type ReactNode } from 'react'

export interface RenderActions {
  startRender: () => Promise<void>
  takeScreenshot: () => Promise<void>
  isRendering: boolean
}

const RenderActionsContext = createContext<RenderActions | null>(null)

export function RenderActionsProvider({
  children,
  actions,
}: {
  children: ReactNode
  actions: RenderActions
}) {
  return <RenderActionsContext.Provider value={actions}>{children}</RenderActionsContext.Provider>
}

export function useRenderActions(): RenderActions | null {
  return useContext(RenderActionsContext)
}
