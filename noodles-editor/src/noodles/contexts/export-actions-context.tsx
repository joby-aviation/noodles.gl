import { createContext, useContext, useMemo, type ReactNode } from 'react'

interface ExportActionsContextValue {
  startRender: (() => Promise<void>) | null
  takeScreenshot: (() => Promise<void>) | null
  isRendering: boolean
}

const ExportActionsContext = createContext<ExportActionsContextValue>({
  startRender: null,
  takeScreenshot: null,
  isRendering: false,
})

interface ExportActionsProviderProps {
  startRender: (() => Promise<void>) | null
  takeScreenshot: (() => Promise<void>) | null
  isRendering: boolean
  children: ReactNode
}

export function ExportActionsProvider({
  startRender,
  takeScreenshot,
  isRendering,
  children,
}: ExportActionsProviderProps) {
  const value = useMemo(
    () => ({ startRender, takeScreenshot, isRendering }),
    [startRender, takeScreenshot, isRendering]
  )
  return <ExportActionsContext.Provider value={value}>{children}</ExportActionsContext.Provider>
}

export function useExportActions() {
  return useContext(ExportActionsContext)
}
