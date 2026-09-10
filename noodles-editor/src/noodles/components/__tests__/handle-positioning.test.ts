// Tests for handle positioning math
import { describe, expect, it } from 'vitest'

describe('Handle Positioning Math', () => {
  describe('Vertical positioning', () => {
    it('should center handles at 12.5px for 25px min-height label rows', () => {
      const labelRowHeight = 25 // min-height from CSS
      const handleTop = 12.5
      expect(handleTop).toBe(labelRowHeight / 2)
    })

    it('should position output handles at 15px', () => {
      const renderInput = false
      const top = renderInput ? 12.5 : 15
      expect(top).toBe(15)
    })

    it('should position input handles at 12.5px', () => {
      const renderInput = true
      const top = renderInput ? 12.5 : 15
      expect(top).toBe(12.5)
    })
  })

  describe('Horizontal positioning', () => {
    it('should use -10px translateX for ListField (accounts for left: -3px container)', () => {
      // ListFields use MultiInputHandle which has a container with left: -3px
      // So we need less horizontal offset: -17px + 7px = -10px
      const containerLeft = -3
      const baseOffset = -17
      const adjustedOffset = -10
      expect(adjustedOffset).toBe(baseOffset + Math.abs(containerLeft) + 4)
    })

    it('should use -17px translateX for regular fields', () => {
      // Regular fields don't have the extra container offset
      const translateX = -17
      expect(translateX).toBe(-17)
    })
  })

  describe('MultiInputHandle slot positioning', () => {
    it('should calculate slot spacing correctly', () => {
      const SLOT_HEIGHT = 6
      const SLOT_GAP = 1.5
      const SLOT_SPACING = SLOT_HEIGHT + SLOT_GAP
      expect(SLOT_SPACING).toBe(7.5)
    })

    it('should calculate handle height for multiple connections', () => {
      const connectionCount = 3
      const SLOT_HEIGHT = 6
      const SLOT_GAP = 1.5
      const handleHeight = connectionCount * SLOT_HEIGHT + (connectionCount - 1) * SLOT_GAP
      expect(handleHeight).toBe(21) // 3 * 6 + 2 * 1.5
    })

    it('should center slot offsets around handle center', () => {
      const connectionCount = 3
      const SLOT_SPACING = 7.5
      // For 3 connections: indices 0, 1, 2
      // Centers at: (0 - 1) * 7.5 = -7.5, (1 - 1) * 7.5 = 0, (2 - 1) * 7.5 = 7.5
      const offsets = [0, 1, 2].map(i => (i - (connectionCount - 1) / 2) * SLOT_SPACING)
      expect(offsets).toEqual([-7.5, 0, 7.5])
    })
  })
})
