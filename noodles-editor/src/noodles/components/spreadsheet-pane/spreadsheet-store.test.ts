import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../../editor/ui-store'

describe('UIStore — spreadsheet state', () => {
  beforeEach(() => {
    // Reset spreadsheet-related store state before each test
    useUIStore.setState({ pinnedSpreadsheetNodeId: null })
  })

  it('initializes pinnedSpreadsheetNodeId as null', () => {
    expect(useUIStore.getState().pinnedSpreadsheetNodeId).toBeNull()
  })

  it('setPinnedSpreadsheetNodeId updates state', () => {
    useUIStore.getState().setPinnedSpreadsheetNodeId('/my-op')
    expect(useUIStore.getState().pinnedSpreadsheetNodeId).toBe('/my-op')
    useUIStore.getState().setPinnedSpreadsheetNodeId(null)
    expect(useUIStore.getState().pinnedSpreadsheetNodeId).toBeNull()
  })
})
