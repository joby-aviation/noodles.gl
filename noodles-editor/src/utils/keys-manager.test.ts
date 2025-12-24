import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type KeysConfig,
  clearKeysFromStorage,
  getKeysForProject,
  getKeysFromStorage,
  keysManager,
  maskKey,
  saveKeysToStorage,
} from './keys-manager'

describe('keysManager', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    // Reset project keys
    keysManager.setProjectKeys(undefined)
    // Clear any environment variable mocks
    vi.unstubAllEnvs()
  })

  describe('getKey', () => {
    it('should return undefined when no key is available from any source', () => {
      expect(keysManager.getKey('mapbox')).toBeUndefined()
      expect(keysManager.getKey('googleMaps')).toBeUndefined()
      expect(keysManager.getKey('anthropic')).toBeUndefined()
    })

    it('should prioritize localStorage over project keys', () => {
      const localStorageKeys: KeysConfig = {
        mapbox: 'localStorage-token',
      }
      const projectKeys: KeysConfig = {
        mapbox: 'project-token',
      }

      saveKeysToStorage(localStorageKeys, false)
      keysManager.setProjectKeys(projectKeys)

      expect(keysManager.getKey('mapbox')).toBe('localStorage-token')
    })

    it('should use project keys when localStorage is empty', () => {
      const projectKeys: KeysConfig = {
        mapbox: 'project-token',
      }

      keysManager.setProjectKeys(projectKeys)

      expect(keysManager.getKey('mapbox')).toBe('project-token')
    })

    it('should use project keys passed as parameter', () => {
      const projectKeys: KeysConfig = {
        mapbox: 'param-project-token',
      }

      expect(keysManager.getKey('mapbox', projectKeys)).toBe('param-project-token')
    })

    it('should prioritize localStorage over parameter project keys', () => {
      const localStorageKeys: KeysConfig = {
        mapbox: 'localStorage-token',
      }
      const projectKeys: KeysConfig = {
        mapbox: 'param-project-token',
      }

      saveKeysToStorage(localStorageKeys, false)

      expect(keysManager.getKey('mapbox', projectKeys)).toBe('localStorage-token')
    })

    it('should fall back to environment variables when no other source is available', () => {
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'env-mapbox-token')
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'env-google-token')
      vi.stubEnv('VITE_CLAUDE_API_KEY', 'env-anthropic-token')

      expect(keysManager.getKey('mapbox')).toBe('env-mapbox-token')
      expect(keysManager.getKey('googleMaps')).toBe('env-google-token')
      expect(keysManager.getKey('anthropic')).toBe('env-anthropic-token')
    })

    it('should prioritize localStorage over environment variables', () => {
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'env-mapbox-token')

      const localStorageKeys: KeysConfig = {
        mapbox: 'localStorage-token',
      }
      saveKeysToStorage(localStorageKeys, false)

      expect(keysManager.getKey('mapbox')).toBe('localStorage-token')
    })

    it('should prioritize project keys over environment variables', () => {
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'env-mapbox-token')

      const projectKeys: KeysConfig = {
        mapbox: 'project-token',
      }
      keysManager.setProjectKeys(projectKeys)

      expect(keysManager.getKey('mapbox')).toBe('project-token')
    })
  })

  describe('hasKey', () => {
    it('should return false when no key is available', () => {
      expect(keysManager.hasKey('mapbox')).toBe(false)
    })

    it('should return true when key is available from localStorage', () => {
      const keys: KeysConfig = {
        mapbox: 'test-token',
      }
      saveKeysToStorage(keys, false)

      expect(keysManager.hasKey('mapbox')).toBe(true)
    })

    it('should return true when key is available from project keys', () => {
      const keys: KeysConfig = {
        mapbox: 'test-token',
      }
      keysManager.setProjectKeys(keys)

      expect(keysManager.hasKey('mapbox')).toBe(true)
    })

    it('should return true when key is available from environment variables', () => {
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'env-token')

      expect(keysManager.hasKey('mapbox')).toBe(true)
    })
  })

  describe('setProjectKeys and getProjectKeys', () => {
    it('should set and get project keys', () => {
      const keys: KeysConfig = {
        mapbox: 'project-token',
        googleMaps: 'google-token',
      }

      keysManager.setProjectKeys(keys)

      expect(keysManager.getProjectKeys()).toEqual(keys)
    })

    it('should return undefined when no project keys are set', () => {
      expect(keysManager.getProjectKeys()).toBeUndefined()
    })

    it('should allow clearing project keys by passing undefined', () => {
      const keys: KeysConfig = {
        mapbox: 'project-token',
      }

      keysManager.setProjectKeys(keys)
      expect(keysManager.getProjectKeys()).toEqual(keys)

      keysManager.setProjectKeys(undefined)
      expect(keysManager.getProjectKeys()).toBeUndefined()
    })
  })
})

describe('getKeysFromStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should return empty keys and saveInProject false by default', () => {
    const result = getKeysFromStorage()

    expect(result.keys).toEqual({})
    expect(result.saveInProject).toBe(false)
  })

  it('should return saved keys from localStorage', () => {
    const keys: KeysConfig = {
      mapbox: 'test-mapbox-token',
      googleMaps: 'test-google-token',
      anthropic: 'test-anthropic-token',
    }

    saveKeysToStorage(keys, true)

    const result = getKeysFromStorage()

    expect(result.keys).toEqual(keys)
    expect(result.saveInProject).toBe(true)
  })

  it('should handle corrupted localStorage data gracefully', () => {
    localStorage.setItem('noodles-keys', 'invalid-json')

    const result = getKeysFromStorage()

    expect(result.keys).toEqual({})
    expect(result.saveInProject).toBe(false)
  })
})

describe('saveKeysToStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should save keys to localStorage', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
    }

    saveKeysToStorage(keys, false)

    const result = getKeysFromStorage()
    expect(result.keys).toEqual(keys)
    expect(result.saveInProject).toBe(false)
  })

  it('should save saveInProject flag', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
    }

    saveKeysToStorage(keys, true)

    const result = getKeysFromStorage()
    expect(result.saveInProject).toBe(true)
  })

  it('should trim whitespace from keys', () => {
    const keys: KeysConfig = {
      mapbox: '  test-mapbox-token  ',
      googleMaps: '  test-google-token  ',
      anthropic: '  test-anthropic-token  ',
    }

    saveKeysToStorage(keys, false)

    const result = getKeysFromStorage()
    expect(result.keys).toEqual({
      mapbox: 'test-mapbox-token',
      googleMaps: 'test-google-token',
      anthropic: 'test-anthropic-token',
    })
  })

  it('should remove empty string keys', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
      googleMaps: '',
      anthropic: '   ',
    }

    saveKeysToStorage(keys, false)

    const result = getKeysFromStorage()
    expect(result.keys).toEqual({
      mapbox: 'test-token',
    })
  })

  it('should handle localStorage errors gracefully', () => {
    // Mock localStorage.setItem to throw an error
    const originalSetItem = localStorage.setItem
    localStorage.setItem = vi.fn(() => {
      throw new Error('Storage quota exceeded')
    })

    const keys: KeysConfig = {
      mapbox: 'test-token',
    }

    // Should not throw
    expect(() => saveKeysToStorage(keys, false)).not.toThrow()

    // Restore original implementation
    localStorage.setItem = originalSetItem
  })
})

describe('clearKeysFromStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should clear all keys from localStorage', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
      googleMaps: 'google-token',
    }

    saveKeysToStorage(keys, true)

    // Verify keys are saved
    expect(getKeysFromStorage().keys).toEqual(keys)
    expect(getKeysFromStorage().saveInProject).toBe(true)

    clearKeysFromStorage()

    // Verify keys are cleared
    const result = getKeysFromStorage()
    expect(result.keys).toEqual({})
    expect(result.saveInProject).toBe(false)
  })

  it('should handle localStorage errors gracefully', () => {
    // Mock localStorage.removeItem to throw an error
    const originalRemoveItem = localStorage.removeItem
    localStorage.removeItem = vi.fn(() => {
      throw new Error('Storage error')
    })

    // Should not throw
    expect(() => clearKeysFromStorage()).not.toThrow()

    // Restore original implementation
    localStorage.removeItem = originalRemoveItem
  })
})

describe('getKeysForProject', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should return undefined when saveInProject is false', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
    }

    saveKeysToStorage(keys, false)

    expect(getKeysForProject()).toBeUndefined()
  })

  it('should return keys when saveInProject is true', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
      googleMaps: 'google-token',
    }

    saveKeysToStorage(keys, true)

    expect(getKeysForProject()).toEqual(keys)
  })

  it('should return undefined when no keys are saved', () => {
    expect(getKeysForProject()).toBeUndefined()
  })
})

describe('maskKey', () => {
  it('should mask short keys completely', () => {
    expect(maskKey('short')).toBe('••••••••')
    expect(maskKey('')).toBe('••••••••')
  })

  it('should show first 6 characters and mask rest with at least 8 dots', () => {
    // 'sk-abcd' is 7 chars, shows first 6 + max(8, 7-6) = 6 + 8 dots
    expect(maskKey('sk-abcd')).toBe('sk-abc••••••••')

    // Normal API key: 'sk-abcdefghijklmnopqrstuvwxyz' is 29 chars
    // shows first 6 + max(8, 29-6) = 6 + 23 dots
    expect(maskKey('sk-abcdefghijklmnopqrstuvwxyz')).toBe('sk-abc•••••••••••••••••••••••')
  })

  it('should handle long keys', () => {
    const longKey = 'a'.repeat(100)
    const masked = maskKey(longKey)
    expect(masked.startsWith('aaaaaa')).toBe(true)
    expect(masked.endsWith('•')).toBe(true)
    // first 6 + max(8, 100-6) = 6 + 94 = 100
    expect(masked.length).toBe(100)
  })
})
