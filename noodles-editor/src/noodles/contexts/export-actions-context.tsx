import { createContext, type ReactNode, useContext, useMemo } from 'react'

interface ExportActionsContextValue {
  startRender: (() => Promise<void>) | null
  takeScreenshot: (() => Promise<void>) | null
  exportSequence: (() => Promise<void>) | null
  selectRendersDirectory: (() => Promise<void>) | null
  isRendering: boolean
}

const ExportActionsContext = createContext<ExportActionsContextValue>({
  startRender: null,
  takeScreenshot: null,
  exportSequence: null,
  selectRendersDirectory: null,
  isRendering: false,
})

interface ExportActionsProviderProps {
  startRender: (() => Promise<void>) | null
  takeScreenshot: (() => Promise<void>) | null
  exportSequence: (() => Promise<void>) | null
  selectRendersDirectory: (() => Promise<void>) | null
  isRendering: boolean
  children: ReactNode
}

export function ExportActionsProvider({
  startRender,
  takeScreenshot,
  exportSequence,
  selectRendersDirectory,
  isRendering,
  children,
}: ExportActionsProviderProps) {
  const value = useMemo(
    () => ({ startRender, takeScreenshot, exportSequence, selectRendersDirectory, isRendering }),
    [startRender, takeScreenshot, exportSequence, selectRendersDirectory, isRendering]
  )
  return <ExportActionsContext.Provider value={value}>{children}</ExportActionsContext.Provider>
}

export function useExportActions() {
  return useContext(ExportActionsContext)
}
