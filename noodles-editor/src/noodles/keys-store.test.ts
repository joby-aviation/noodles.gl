import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_KEY_TYPES,
  fingerprintKey,
  getEnvKeys,
  getKeysForProject,
  getKeysStore,
  isAIKey,
  type KeysConfig,
  keysProjectId,
  useKeysStore,
} from './keys-store'

describe('Keys Store', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    // Reset store state
    useKeysStore.setState({
      browserKeys: {},
      keyOverrides: {},
      projectKeys: undefined,
      projectId: undefined,
      projectKeyEdits: 0,
      ignoredProjectKeys: [],
    })
  })

  describe('getKey', () => {
    it('should return undefined when no key is available from browser or project', () => {
      // Note: env keys may exist from .env.local but won't interfere with this test
      // since we're testing browser and project keys specifically
      const { getKey, setBrowserKey, setProjectKeys } = getKeysStore()

      // Ensure no browser or project keys
      setBrowserKey('mapbox', undefined)
      setProjectKeys(undefined)

      // getKey may return env key if present, which is correct behavior
      // So we test that browser/project keys work correctly instead
      const envKeys = getEnvKeys()
      const result = getKey('mapbox')

      // Result should be undefined OR from env (not from browser/project since those are cleared)
      expect(result === undefined || result === envKeys.mapbox).toBe(true)
    })

    it('should prioritize project keys over browserKeys', () => {
      const { setBrowserKey, setProjectKeys, getKey } = getKeysStore()

      setProjectKeys({ mapbox: 'project-token' })
      setBrowserKey('mapbox', 'browser-token')

      expect(getKey('mapbox')).toBe('project-token')
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
    it('should return false when no key is available from browser or project', () => {
      // Note: env keys may exist, so we test with cleared browser/project keys
      const { hasKey, setBrowserKey, setProjectKeys } = getKeysStore()

      // Clear browser and project keys
      setBrowserKey('mapbox', undefined)
      setProjectKeys(undefined)

      // hasKey may return true if env key exists, which is correct
      const envKeys = getEnvKeys()
      const result = hasKey('mapbox')

      // Result should match whether env key exists
      expect(result).toBe(!!envKeys.mapbox)
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

    it('should remove one project key without clearing the others', () => {
      const { setProjectKeys, removeProjectKey } = getKeysStore()
      setProjectKeys({ mapbox: 'mapbox-token', googleMaps: 'google-token' })

      removeProjectKey('mapbox')

      expect(getKeysStore().projectKeys).toEqual({ googleMaps: 'google-token' })
    })

    it('should clear project keys after removing the final key', () => {
      const { setProjectKeys, removeProjectKey } = getKeysStore()
      setProjectKeys({ mapbox: 'mapbox-token' })

      removeProjectKey('mapbox')

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
    it('should return null or env when no browser/project key', () => {
      // Clear browser and project keys
      const { getActiveSource, setBrowserKey, setProjectKeys } = getKeysStore()
      setBrowserKey('mapbox', undefined)
      setProjectKeys(undefined)

      // getActiveSource may return 'env' if env key exists, or null if not
      const envKeys = getEnvKeys()
      const result = getActiveSource('mapbox')

      // Result should be null or 'env' depending on whether env key exists
      if (envKeys.mapbox) {
        expect(result).toBe('env')
      } else {
        expect(result).toBeNull()
      }
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

    it('should prioritize project over browser', () => {
      const { setBrowserKey, setProjectKeys, getActiveSource } = getKeysStore()

      setBrowserKey('mapbox', 'browser-token')
      expect(getActiveSource('mapbox')).toBe('browser')

      setProjectKeys({ mapbox: 'project-token' })
      expect(getActiveSource('mapbox')).toBe('project')
    })
  })

  describe('overrides', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_CESIUM_ACCESS_TOKEN', 'env-cesium')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-a')
      getKeysStore().setBrowserKey('cesium', 'browser-cesium')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('should use the browser key for the project that chose it', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')

      expect(getKeysStore().getKey('cesium')).toBe('browser-cesium')
      expect(getKeysStore().getActiveSource('cesium')).toBe('browser')
    })

    it('should use the env key for the project that chose it', () => {
      getKeysStore().setKeyOverride('cesium', 'env')

      expect(getKeysStore().getKey('cesium')).toBe('env-cesium')
    })

    it('should not apply to another project', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-b')

      expect(getKeysStore().getKey('cesium')).toBe('project-cesium')
    })

    it('should apply again when the project is reopened', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().setProjectKeys(undefined, 'project-b')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-a')

      expect(getKeysStore().getKey('cesium')).toBe('browser-cesium')
    })

    it('should lapse when the project key changes', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().setProjectKeys({ cesium: 'new-project-cesium' }, 'project-a')

      expect(getKeysStore().getKey('cesium')).toBe('new-project-cesium')
      expect(getKeysStore().getOverride('cesium')).toBeNull()
    })

    it('should fall back to the project key when the browser key is cleared', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().clearBrowserKey('cesium')

      expect(getKeysStore().getKey('cesium')).toBe('project-cesium')
    })

    it('should store a fingerprint, never a key', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')

      const stored = localStorage.getItem('noodles-keys')!
      expect(JSON.parse(stored).state.keyOverrides).toEqual({
        'project-a': {
          cesium: { source: 'browser', projectKeyFingerprint: fingerprintKey('project-cesium') },
        },
      })
      expect(stored).not.toContain('project-cesium')
    })

    it('should go back to the project key when the override is removed', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().setKeyOverride('cesium', null)

      expect(getKeysStore().getKey('cesium')).toBe('project-cesium')
      expect(getKeysStore().keyOverrides).toEqual({})
    })

    it('should copy the choices when the project is saved under a new name', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().copyKeyOverridesTo('project-renamed')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-renamed')

      expect(getKeysStore().getKey('cesium')).toBe('browser-cesium')
      expect(Object.keys(getKeysStore().keyOverrides)).toEqual(['project-a', 'project-renamed'])
    })

    it('should move the choices when the project is renamed', () => {
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().moveKeyOverridesTo('project-renamed')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-renamed')

      expect(getKeysStore().getKey('cesium')).toBe('browser-cesium')
      expect(Object.keys(getKeysStore().keyOverrides)).toEqual(['project-renamed'])
    })

    it('should replace choices left at the new name by an earlier project', () => {
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-b')
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-c')
      getKeysStore().copyKeyOverridesTo('project-b')
      getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-b')

      expect(getKeysStore().getKey('cesium')).toBe('project-cesium')
    })

    it('should keep choices for an example apart from a saved project of the same name', () => {
      getKeysStore().setProjectKeys(
        { cesium: 'project-cesium' },
        keysProjectId('/examples', 'nyc-taxis')
      )
      getKeysStore().setKeyOverride('cesium', 'browser')
      getKeysStore().setProjectKeys(
        { cesium: 'project-cesium' },
        keysProjectId('/projects', 'nyc-taxis')
      )

      expect(getKeysStore().getKey('cesium')).toBe('project-cesium')
    })

    it('should not record an override without a project key', () => {
      getKeysStore().setProjectKeys(undefined, 'project-a')
      getKeysStore().setKeyOverride('cesium', 'browser')

      expect(getKeysStore().keyOverrides).toEqual({})
    })
  })

  describe('setProjectKey', () => {
    it('should remember the loaded keys until the project is saved', () => {
      const { setProjectKeys, setProjectKey, markProjectKeysSaved } = getKeysStore()
      setProjectKeys({ mapbox: 'project-mapbox' })
      setProjectKey('mapbox', 'edited-mapbox')
      expect(getKeysStore().savedProjectKeys).toEqual({ mapbox: 'project-mapbox' })

      markProjectKeysSaved()
      expect(getKeysStore().savedProjectKeys).toEqual({ mapbox: 'edited-mapbox' })
    })

    it('should edit one project key and count the edit', () => {
      const { setProjectKeys, setProjectKey } = getKeysStore()
      setProjectKeys({ mapbox: 'project-mapbox' })
      setProjectKey('googleMaps', ' project-google ')

      expect(getKeysStore().projectKeys).toEqual({
        mapbox: 'project-mapbox',
        googleMaps: 'project-google',
      })
      expect(getKeysStore().projectKeyEdits).toBe(1)
    })

    it('should remove the key when cleared', () => {
      const { setProjectKeys, setProjectKey } = getKeysStore()
      setProjectKeys({ mapbox: 'project-mapbox' })
      setProjectKey('mapbox', '')

      expect(getKeysStore().projectKeys).toBeUndefined()
    })

    it('should not count loading a project as an edit', () => {
      getKeysStore().setProjectKeys({ mapbox: 'project-mapbox' })

      expect(getKeysStore().projectKeyEdits).toBe(0)
    })

    it('should refuse AI keys', () => {
      getKeysStore().setProjectKey('anthropic', 'project-anthropic')

      expect(getKeysStore().projectKeys).toBeUndefined()
      expect(getKeysStore().projectKeyEdits).toBe(0)
    })
  })

  describe('AI keys', () => {
    it('should treat only the AI provider keys as AI keys', () => {
      expect(AI_KEY_TYPES).toEqual(['anthropic', 'openrouter'])
      expect(isAIKey('anthropic')).toBe(true)
      expect(isAIKey('openrouter')).toBe(true)
      expect(isAIKey('mapbox')).toBe(false)
      expect(isAIKey('googleMaps')).toBe(false)
      expect(isAIKey('cesium')).toBe(false)
      expect(isAIKey('overpass')).toBe(false)
    })

    it('should strip AI keys when project keys are set', () => {
      getKeysStore().setProjectKeys({
        mapbox: 'project-mapbox',
        anthropic: 'project-anthropic',
        openrouter: 'project-openrouter',
      })

      const state = getKeysStore()
      expect(state.projectKeys).toEqual({ mapbox: 'project-mapbox' })
      expect(state.ignoredProjectKeys).toEqual(['anthropic', 'openrouter'])
    })

    it('should leave no project keys when the file only had AI keys', () => {
      getKeysStore().setProjectKeys({ anthropic: 'project-anthropic' })

      expect(getKeysStore().projectKeys).toBeUndefined()
      expect(getKeysStore().ignoredProjectKeys).toEqual(['anthropic'])
    })

    it('should forget ignored AI keys when the next project has none', () => {
      const { setProjectKeys } = getKeysStore()
      setProjectKeys({ anthropic: 'project-anthropic' })
      setProjectKeys({ mapbox: 'project-mapbox' })

      expect(getKeysStore().ignoredProjectKeys).toEqual([])
    })

    it('should ignore an AI key in projectKeys even if one gets there', () => {
      // setProjectKeys strips them, so this checks the getters guard on their own
      useKeysStore.setState({
        projectKeys: { anthropic: 'project-anthropic', openrouter: 'project-openrouter' },
      })
      const envKeys = getEnvKeys()
      const { getKey, hasKey, getActiveSource } = getKeysStore()

      for (const key of AI_KEY_TYPES) {
        expect(getKey(key)).toBe(envKeys[key])
        expect(hasKey(key)).toBe(!!envKeys[key])
        expect(getActiveSource(key)).toBe(envKeys[key] ? 'env' : null)
      }
    })

    it('should still use a browser AI key', () => {
      const { setProjectKeys, setBrowserKey, getKey, getActiveSource } = getKeysStore()
      setProjectKeys({ anthropic: 'project-anthropic' })
      setBrowserKey('anthropic', 'browser-anthropic')

      expect(getKey('anthropic')).toBe('browser-anthropic')
      expect(getActiveSource('anthropic')).toBe('browser')
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

    it('should drop the old saveInProject setting when migrating', async () => {
      localStorage.setItem(
        'noodles-keys',
        JSON.stringify({
          state: { browserKeys: { mapbox: 'old-token' }, saveInProject: true },
          version: 0,
        })
      )
      await useKeysStore.persist.rehydrate()

      const state = getKeysStore() as unknown as Record<string, unknown>
      expect(state.saveInProject).toBeUndefined()
      expect(getKeysStore().browserKeys).toEqual({ mapbox: 'old-token' })
      expect(getKeysStore().keyOverrides).toEqual({})
    })

    it('should NOT persist projectKeys', () => {
      const { setProjectKeys } = getKeysStore()
      setProjectKeys({ mapbox: 'project-key', anthropic: 'project-anthropic' })

      const stored = localStorage.getItem('noodles-keys')
      if (stored) {
        const parsed = JSON.parse(stored)
        expect(parsed.state.projectKeys).toBeUndefined()
        expect(parsed.state.ignoredProjectKeys).toBeUndefined()
      }
    })

    it('should load persisted state from localStorage', () => {
      // Zustand persist middleware handles restoration on module load
      // We can test that persisted state is accessible
      const { setBrowserKey } = getKeysStore()

      setBrowserKey('mapbox', 'persisted-token')

      // Verify it was saved
      const stored = localStorage.getItem('noodles-keys')
      expect(stored).toBeTruthy()

      // Verify state is correct
      const state = getKeysStore()
      expect(state.browserKeys.mapbox).toBe('persisted-token')
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
  })
})

describe('getKeysForProject', () => {
  beforeEach(() => {
    localStorage.clear()
    useKeysStore.setState({
      browserKeys: {},
      keyOverrides: {},
      projectKeys: undefined,
      projectId: undefined,
      projectKeyEdits: 0,
      ignoredProjectKeys: [],
    })
  })

  it('should never save browser keys', () => {
    const { setBrowserKeys } = getKeysStore()
    setBrowserKeys({ mapbox: 'browser-mapbox', anthropic: 'browser-anthropic' })

    expect(getKeysForProject()).toBeUndefined()
  })

  it('should save the loaded project keys', () => {
    const { setProjectKeys } = getKeysStore()
    setProjectKeys({ googleMaps: 'project-token' })

    expect(getKeysForProject()).toEqual({ googleMaps: 'project-token' })
  })

  it('should save a project key edited after loading', () => {
    const { setProjectKeys, setProjectKey } = getKeysStore()
    setProjectKeys({ googleMaps: 'project-token' })
    setProjectKey('mapbox', 'new-mapbox')

    expect(getKeysForProject()).toEqual({ googleMaps: 'project-token', mapbox: 'new-mapbox' })
  })

  it('should drop AI keys a loaded project contained', () => {
    const { setProjectKeys } = getKeysStore()
    setProjectKeys({ googleMaps: 'project-google', openrouter: 'project-openrouter' })

    expect(getKeysForProject()).toEqual({ googleMaps: 'project-google' })
  })

  it('should drop AI keys even if they reach projectKeys directly', () => {
    useKeysStore.setState({
      projectKeys: { cesium: 'project-cesium', anthropic: 'project-anthropic' },
    })

    expect(getKeysForProject()).toEqual({ cesium: 'project-cesium' })
  })
})
