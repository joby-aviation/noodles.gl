import { create } from 'zustand'

export interface RenderActions {
  startRender: () => Promise<void>
  takeScreenshot: () => Promise<void>
  isRendering: boolean
}

interface RenderStore {
  actions: RenderActions | null
  setActions: (actions: RenderActions) => void
}

export const useRenderStore = create<RenderStore>((set) => ({
  actions: null,
  setActions: (actions) => set({ actions }),
}))

/**
 * Hook to access render actions (startRender, takeScreenshot, isRendering).
 * Returns null if render actions haven't been initialized yet.
 */
export const useRenderActions = (): RenderActions | null => {
  return useRenderStore((state) => state.actions)
}
