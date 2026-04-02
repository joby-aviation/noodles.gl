import { createContext } from 'react'

export const SheetContext = createContext<unknown>(null)
export const SheetProvider = SheetContext.Provider
