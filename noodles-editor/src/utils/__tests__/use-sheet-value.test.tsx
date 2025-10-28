// Tests for useSheetValue hook
// Tests Theatre.js sheet value subscription
import { getProject, types } from '@theatre/core'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import useSheetValue from '../use-sheet-value'

describe('useSheetValue', () => {
  let projectCounter = 0

  beforeEach(() => {
    projectCounter++
  })

  it('returns the initial value of a sheet object', () => {
    const project = getProject(`test-project-${projectCounter}`, {})
    const sheet = project.sheet('test-sheet')
    const sheetObject = sheet.object('test-object', {
      x: types.number(10),
      y: types.number(20),
    })

    const { result } = renderHook(() => useSheetValue(sheetObject))

    expect(result.current.x).toBe(10)
    expect(result.current.y).toBe(20)
  })

  it('returns correct values for multiple properties', () => {
    const project = getProject(`test-project-${projectCounter}`, {})
    const sheet = project.sheet('test-sheet')
    const sheetObject = sheet.object('test-object', {
      name: types.string('initial'),
      value: types.number(100),
      enabled: types.boolean(false),
    })

    const { result } = renderHook(() => useSheetValue(sheetObject))

    expect(result.current.name).toBe('initial')
    expect(result.current.value).toBe(100)
    expect(result.current.enabled).toBe(false)
  })

  it('handles compound properties', () => {
    const project = getProject(`test-project-${projectCounter}`, {})
    const sheet = project.sheet('test-sheet')
    const sheetObject = sheet.object('test-object', {
      position: types.compound({
        x: types.number(5),
        y: types.number(10),
      }),
    })

    const { result } = renderHook(() => useSheetValue(sheetObject))

    expect(result.current.position.x).toBe(5)
    expect(result.current.position.y).toBe(10)
  })

  it('cleans up subscriptions on unmount', () => {
    const project = getProject(`test-project-${projectCounter}`, {})
    const sheet = project.sheet('test-sheet')
    const sheetObject = sheet.object('test-object', {
      value: types.number(0),
    })

    const { unmount } = renderHook(() => useSheetValue(sheetObject))

    // Unmounting should not throw errors
    expect(() => unmount()).not.toThrow()
  })

  it('works with string literal types', () => {
    const project = getProject(`test-project-${projectCounter}`, {})
    const sheet = project.sheet('test-sheet')
    const sheetObject = sheet.object('test-object', {
      mode: types.stringLiteral('a', { a: 'Option A', b: 'Option B' }),
    })

    const { result } = renderHook(() => useSheetValue(sheetObject))

    expect(result.current.mode).toBe('a')
  })

  it('works with RGBA colors', () => {
    const project = getProject(`test-project-${projectCounter}`, {})
    const sheet = project.sheet('test-sheet')
    const sheetObject = sheet.object('test-object', {
      color: types.rgba({ r: 1, g: 0, b: 0, a: 1 }),
    })

    const { result } = renderHook(() => useSheetValue(sheetObject))

    expect(result.current.color.r).toBe(1)
    expect(result.current.color.g).toBe(0)
    expect(result.current.color.b).toBe(0)
    expect(result.current.color.a).toBe(1)
  })
})
