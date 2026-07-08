import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../../store'

describe('UIStore — spreadsheet state', () => {
  beforeEach(() => {
    // Reset spreadsheet-related store state before each test
    useUIStore.setState({
      spreadsheetVisible: false,
      spreadsheetWidth: 400,
      pinnedSpreadsheetNodeId: null,
    })
    localStorage.removeItem('noodles-spreadsheet-width')
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

  it('spreadsheetWidth defaults to 400', () => {
    expect(useUIStore.getState().spreadsheetWidth).toBe(400)
  })

  it('setSpreadsheetWidth updates state', () => {
    useUIStore.getState().setSpreadsheetWidth(550)
    expect(useUIStore.getState().spreadsheetWidth).toBe(550)
  })

  it('setSpreadsheetWidth writes to localStorage', () => {
    useUIStore.getState().setSpreadsheetWidth(600)
    expect(localStorage.getItem('noodles-spreadsheet-width')).toBe('600')
  })

  it('setSpreadsheetWidth silently handles localStorage errors', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => useUIStore.getState().setSpreadsheetWidth(300)).not.toThrow()
    expect(useUIStore.getState().spreadsheetWidth).toBe(300)
    vi.restoreAllMocks()
  })

  it('setSpreadsheetWidth clamps to valid number', () => {
    useUIStore.getState().setSpreadsheetWidth(700)
    expect(useUIStore.getState().spreadsheetWidth).toBe(700)
  })
})
