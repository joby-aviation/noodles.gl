import { BehaviorSubject } from 'rxjs'
import type { IField } from '../../src/noodles/fields'

// Minimal Field mock - extends BehaviorSubject to support .subscribe()
export class MockField<T = unknown> extends BehaviorSubject<T> implements Partial<IField> {
  accessor = false
  defaultValue?: T

  constructor(initialValue: T, public schema?: unknown) {
    super(initialValue)
    this.defaultValue = initialValue
  }

  setValue(value: T) {
    this.next(value)
  }

  addConnection() {}
  removeConnection() {}
  serialize() {
    return this.value
  }
}

// Type-safe factory functions
export function createMockNumberField(value = 0, options?: { min?: number; max?: number; step?: number }) {
  return new MockField(value, { type: 'number', ...options })
}

export function createMockColorField(value = '#3b82f6') {
  return new MockField(value, { type: 'color' })
}

export function createMockBooleanField(value = false) {
  return new MockField(value, { type: 'boolean' })
}

export function createMockStringField(value = '') {
  return new MockField(value, { type: 'string' })
}

export function createMockVectorField(value: [number, number] = [0, 0]) {
  return new MockField(value, { type: 'vec2' })
}

export function createMockDateField(value = '2024-01-01') {
  return new MockField(value, { type: 'date' })
}

export function createMockCodeField(value = '') {
  return new MockField(value, { type: 'code' })
}
