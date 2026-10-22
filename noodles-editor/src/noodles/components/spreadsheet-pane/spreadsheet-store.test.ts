import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../store'

describe('UIStore — spreadsheet state', () => {
  beforeEach(() => {
    // Reset spreadsheet-related store state before each test
    useUIStore.setState({
      spreadsheetVisible: false,
      pinnedSpreadsheetNodeId: null,
    })
  })

  it('initializes spreadsheetVisible as false', () => {
    expect(useUIStore.getState().spreadsheetVisible).toBe(false)
  })

  it('setSpreadsheetVisible updates state', () => {
    useUIStore.getState().setSpreadsheetVisible(true)
    expect(useUIStore.getState().spreadsheetVisible).toBe(true)
    useUIStore.getState().setSpreadsheetVisible(false)
    expect(useUIStore.getState().spreadsheetVisible).toBe(false)
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
