// Ideally we'd use Theatre, but the base React package doesn't have this, and @theatre/r3f relies on THREE

import type { ISheet } from '@theatre/core'
import { createContext } from 'react'

export const SheetContext = createContext<ISheet | null>(null)
export const SheetProvider = SheetContext.Provider
