import { create } from 'zustand'

// Progress of the running export, for the top bar's Export button. The editor skips
// React re-renders while an export runs, so progress lives here and only the
// components that subscribe re-render. null until the first frame finishes.
interface RenderProgressState {
  percent: number | null
}

export const useRenderProgressStore = create<RenderProgressState>(() => ({ percent: null }))

// Called once per frame: only a change in the whole percent reaches subscribers
export function setRenderProgress(frame: number, total: number) {
  const percent = total > 0 ? Math.min(100, Math.floor((frame / total) * 100)) : 0
  if (useRenderProgressStore.getState().percent !== percent) {
    useRenderProgressStore.setState({ percent })
  }
}

export function resetRenderProgress() {
  useRenderProgressStore.setState({ percent: null })
}
