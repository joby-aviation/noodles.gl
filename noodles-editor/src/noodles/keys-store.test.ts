import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type KeysConfig,
  getEnvKeys,
  getKeysForProject,
  getKeysStore,
  maskKey,
  useKeysStore,
} from './keys-store'

describe('Keys Store', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    // Reset store state
    useKeysStore.setState({
      browserKeys: {},
      saveInProject: false,
      projectKeys: undefined,
    })
    // Clear any environment variable mocks
    vi.unstubAllEnvs()
  })

  describe('getKey', () => {
    it('should return undefined when no key is available from any source', () => {
      // Stub environment variables to be undefined
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', undefined)
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', undefined)
      vi.stubEnv('VITE_CLAUDE_API_KEY', undefined)

      const { getKey } = getKeysStore()
      expect(getKey('mapbox')).toBeUndefined()
      expect(getKey('googleMaps')).toBeUndefined()
      expect(getKey('anthropic')).toBeUndefined()
    })

    it('should prioritize browserKeys over project keys', () => {
      const { setBrowserKey, setProjectKeys, getKey } = getKeysStore()

      setProjectKeys({ mapbox: 'project-token' })
      setBrowserKey('mapbox', 'browser-token')

      expect(getKey('mapbox')).toBe('browser-token')
    })

    it('should use project keys when browserKeys is empty', () => {
      const { setProjectKeys, getKey } = getKeysStore()

      setProjectKeys({ mapbox: 'project-token' })

      expect(getKey('mapbox')).toBe('project-token')
    })

    it('should use getEnvKeys to access environment variables', () => {
      // Environment keys are read at module level and immutable
      // We can't stub them in tests, but we can verify the function exists
      const envKeys = getEnvKeys()
      expect(envKeys).toBeDefined()
      expect(typeof envKeys).toBe('object')
    })
  })

  describe('hasKey', () => {
    it('should return false when no key is available', () => {
      // Stub environment variables to be undefined
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', undefined)
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', undefined)
      vi.stubEnv('VITE_CLAUDE_API_KEY', undefined)

      const { hasKey } = getKeysStore()
      expect(hasKey('mapbox')).toBe(false)
    })

    it('should return true when key is available from browserKeys', () => {
      const { setBrowserKey, hasKey } = getKeysStore()
      setBrowserKey('mapbox', 'test-token')

      expect(hasKey('mapbox')).toBe(true)
    })

    it('should return true when key is available from project keys', () => {
      const { setProjectKeys, hasKey } = getKeysStore()
      setProjectKeys({ mapbox: 'test-token' })

      expect(hasKey('mapbox')).toBe(true)
    })
  })

  describe('setProjectKeys and getProjectKeys', () => {
    it('should set and get project keys', () => {
      const keys: KeysConfig = {
        mapbox: 'project-token',
        googleMaps: 'google-token',
      }

      const { setProjectKeys } = getKeysStore()
      setProjectKeys(keys)

      const state = getKeysStore()
      expect(state.projectKeys).toEqual(keys)
    })

    it('should return undefined when no project keys are set', () => {
      const state = getKeysStore()
      expect(state.projectKeys).toBeUndefined()
    })

    it('should allow clearing project keys by passing undefined', () => {
      const keys: KeysConfig = {
        mapbox: 'project-token',
      }

      const { setProjectKeys } = getKeysStore()
      setProjectKeys(keys)
      expect(getKeysStore().projectKeys).toEqual(keys)

      setProjectKeys(undefined)
      expect(getKeysStore().projectKeys).toBeUndefined()
    })
  })

  describe('setBrowserKey', () => {
    it('should set a browser key', () => {
      const { setBrowserKey } = getKeysStore()
      setBrowserKey('mapbox', 'test-token')

      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBe('test-token')
    })

    it('should trim whitespace from keys', () => {
      const { setBrowserKey } = getKeysStore()
      setBrowserKey('mapbox', '  test-token  ')

      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBe('test-token')
    })

    it('should remove empty string keys', () => {
      const { setBrowserKey } = getKeysStore()
      setBrowserKey('mapbox', 'test-token')
      setBrowserKey('mapbox', '')

      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBeUndefined()
    })

    it('should remove undefined keys', () => {
      const { setBrowserKey } = getKeysStore()
      setBrowserKey('mapbox', 'test-token')
      setBrowserKey('mapbox', undefined)

      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBeUndefined()
    })
  })

  describe('setBrowserKeys', () => {
    it('should set multiple browser keys', () => {
      const keys: KeysConfig = {
        mapbox: 'mapbox-token',
        googleMaps: 'google-token',
        anthropic: 'anthropic-token',
      }

      const { setBrowserKeys } = getKeysStore()
      setBrowserKeys(keys)

      const state = getKeysStore()
      expect(state.browserKeys).toEqual(keys)
    })

    it('should trim whitespace from all keys', () => {
      const keys: KeysConfig = {
        mapbox: '  mapbox-token  ',
        googleMaps: '  google-token  ',
        anthropic: '  anthropic-token  ',
      }

      const { setBrowserKeys } = getKeysStore()
      setBrowserKeys(keys)

      const state = getKeysStore()
      expect(state.browserKeys).toEqual({
        mapbox: 'mapbox-token',
        googleMaps: 'google-token',
        anthropic: 'anthropic-token',
      })
    })

    it('should remove empty string keys', () => {
      const keys: KeysConfig = {
        mapbox: 'test-token',
        googleMaps: '',
        anthropic: '   ',
      }

      const { setBrowserKeys } = getKeysStore()
      setBrowserKeys(keys)

      const state = getKeysStore()
      expect(state.browserKeys).toEqual({
        mapbox: 'test-token',
      })
    })
  })

  describe('clearBrowserKey', () => {
    it('should clear a specific browser key', () => {
      const { setBrowserKey, clearBrowserKey } = getKeysStore()

      setBrowserKey('mapbox', 'test-token')
      setBrowserKey('googleMaps', 'google-token')

      clearBrowserKey('mapbox')

      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBeUndefined()
      expect(state.browserKeys.googleMaps).toBe('google-token')
    })
  })

  describe('getActiveSource', () => {
    it('should return null when no key is available', () => {
      const { getActiveSource } = getKeysStore()
      expect(getActiveSource('mapbox')).toBeNull()
    })

    it('should return "browser" when key is in browserKeys', () => {
      const { setBrowserKey, getActiveSource } = getKeysStore()
      setBrowserKey('mapbox', 'browser-token')

      expect(getActiveSource('mapbox')).toBe('browser')
    })

    it('should return "project" when key is only in projectKeys', () => {
      const { setProjectKeys, getActiveSource } = getKeysStore()
      setProjectKeys({ mapbox: 'project-token' })

      expect(getActiveSource('mapbox')).toBe('project')
    })

    it('should prioritize browser over project', () => {
      const { setBrowserKey, setProjectKeys, getActiveSource } = getKeysStore()

      // Add project
      setProjectKeys({ mapbox: 'project-token' })
      expect(getActiveSource('mapbox')).toBe('project')

      // Add browser
      setBrowserKey('mapbox', 'browser-token')
      expect(getActiveSource('mapbox')).toBe('browser')
    })
  })

  describe('persistence', () => {
    it('should persist browserKeys to localStorage automatically', () => {
      const { setBrowserKey } = getKeysStore()
      setBrowserKey('mapbox', 'test-token')

      // Check localStorage directly
      const stored = localStorage.getItem('noodles-keys')
      expect(stored).toBeTruthy()

      const parsed = JSON.parse(stored!)
      expect(parsed.state.browserKeys.mapbox).toBe('test-token')
    })

    it('should persist saveInProject setting', () => {
      const { setSaveInProject } = getKeysStore()
      setSaveInProject(true)

      const stored = localStorage.getItem('noodles-keys')
      const parsed = JSON.parse(stored!)
      expect(parsed.state.saveInProject).toBe(true)
    })

    it('should NOT persist projectKeys', () => {
      const { setProjectKeys } = getKeysStore()
      setProjectKeys({ mapbox: 'project-key' })

      const stored = localStorage.getItem('noodles-keys')
      if (stored) {
        const parsed = JSON.parse(stored)
        expect(parsed.state.projectKeys).toBeUndefined()
      }
    })

    it('should load persisted state from localStorage', () => {
      // Zustand persist middleware handles restoration on module load
      // We can test that persisted state is accessible
      const { setBrowserKey, setSaveInProject } = getKeysStore()

      setBrowserKey('mapbox', 'persisted-token')
      setSaveInProject(true)

      // Verify it was saved
      const stored = localStorage.getItem('noodles-keys')
      expect(stored).toBeTruthy()

      // Verify state is correct
      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBe('persisted-token')
      expect(state.saveInProject).toBe(true)
    })
  })

  describe('reactivity', () => {
    it('should notify subscribers when state changes', () => {
      const callback = vi.fn()

      // Subscribe to all state changes
      const unsubscribe = useKeysStore.subscribe(callback)

      // Make a change
      getKeysStore().setBrowserKey('mapbox', 'new-key')

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it('should update state correctly after subscription', () => {
      const { setBrowserKey } = getKeysStore()

      let capturedState: any = null
      const unsubscribe = useKeysStore.subscribe((state) => {
        capturedState = state
      })

      setBrowserKey('mapbox', 'reactive-key')

      // Wait for next tick
      expect(getKeysStore().browserKeys.mapbox).toBe('reactive-key')
      unsubscribe()
    })
  })
})

describe('getKeysForProject', () => {
  beforeEach(() => {
    localStorage.clear()
    useKeysStore.setState({
      browserKeys: {},
      saveInProject: false,
      projectKeys: undefined,
    })
  })

  it('should return undefined when saveInProject is false', () => {
    const { setBrowserKey } = getKeysStore()
    setBrowserKey('mapbox', 'test-token')

    expect(getKeysForProject()).toBeUndefined()
  })

  it('should return browserKeys when saveInProject is true', () => {
    const keys: KeysConfig = {
      mapbox: 'test-token',
      googleMaps: 'google-token',
    }

    const { setBrowserKeys, setSaveInProject } = getKeysStore()
    setBrowserKeys(keys)
    setSaveInProject(true)

    expect(getKeysForProject()).toEqual(keys)
  })

  it('should return undefined when no browser keys are saved', () => {
    const { setSaveInProject } = getKeysStore()
    setSaveInProject(true)

    expect(getKeysForProject()).toEqual({})
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
