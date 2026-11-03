import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  KEY_NAMES,
  type KeyPrompt,
  type KeyType,
  PROMPTED_KEY_TYPES,
  useKeysStore,
} from '../noodles/keys-store'
import { analytics } from '../utils/analytics'
import { getLoadedGoogleMapsKey } from '../utils/geocoding'
import s from './key-prompts.module.css'

type PromptedKey = (typeof PROMPTED_KEY_TYPES)[number]

const SERVICE_NAMES: Record<PromptedKey, string> = {
  mapbox: 'Mapbox',
  googleMaps: 'Google',
  cesium: 'Cesium Ion',
}

const SOURCE_NAMES = { browser: 'browser', env: 'environment' } as const

// Asks about a project key when the user has a different one of their own, says when their
// own key is in use instead, and offers theirs when the project's key is rejected
export function KeyPrompts() {
  // Subscribe to everything the prompts read
  useKeysStore(state => state.projectKeys)
  useKeysStore(state => state.savedProjectKeys)
  useKeysStore(state => state.browserKeys)
  useKeysStore(state => state.keyOverrides)
  useKeysStore(state => state.rejectedKeys)
  const projectId = useKeysStore(state => state.projectId)
  const getPrompt = useKeysStore(state => state.getPrompt)
  const getKey = useKeysStore(state => state.getKey)
  const setKeyOverride = useKeysStore(state => state.setKeyOverride)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  // Keys answered here, so the reload a choice needs is still asked for once its prompt closes
  const [answered, setAnswered] = useState<Set<string>>(() => new Set())

  // The Maps JavaScript API keeps the key it loaded with
  const needsReload = (key: PromptedKey) => {
    const loadedKey = key === 'googleMaps' ? getLoadedGoogleMapsKey() : null
    return !!loadedKey && loadedKey !== getKey(key)
  }

  const prompts = PROMPTED_KEY_TYPES.flatMap(key => {
    const prompt: KeyPrompt | { kind: 'reload' } | null =
      getPrompt(key) ??
      (answered.has(`${projectId}|${key}`) && needsReload(key) ? { kind: 'reload' } : null)
    if (!prompt) return []
    const id = `${projectId}|${key}|${prompt.kind}`
    return dismissed.has(id) ? [] : [{ key, prompt, id }]
  })
  if (prompts.length === 0) return null

  const answer = (key: KeyType, prompt: KeyPrompt, source: 'project' | 'browser' | 'env') => {
    setKeyOverride(key, source)
    setAnswered(previous => new Set(previous).add(`${projectId}|${key}`))
    analytics.track('key_prompt_answered', { key, kind: prompt.kind, source })
  }

  const dismiss = (id: string, key: KeyType, kind: string) => {
    setDismissed(previous => new Set(previous).add(id))
    analytics.track('key_prompt_dismissed', { key, kind })
  }

  // In the body, so the docked map's layers can't sit above the prompts and take their clicks
  return createPortal(
    <div className={s.prompts}>
      {prompts.map(({ key, prompt, id }) => (
        <div key={id} className={s.prompt} role="status">
          <p className={s.text}>
            {prompt.kind === 'choose' &&
              `This project uses its own ${KEY_NAMES[key]} instead of yours.`}
            {prompt.kind === 'overridden' &&
              `Using your ${SOURCE_NAMES[prompt.source]} ${KEY_NAMES[key]} for this project.`}
            {prompt.kind === 'rejected' &&
              `${SERVICE_NAMES[key]} rejected the project's ${KEY_NAMES[key]} on this site.`}
            {prompt.kind === 'reload' &&
              `${SERVICE_NAMES[key]} search and directions still use the previous ${KEY_NAMES[key]}.`}
            {needsReload(key) && (
              <span className={s.secondaryText}> Reload the page to apply it.</span>
            )}
          </p>
          <div className={s.actions}>
            <button
              type="button"
              onClick={() => dismiss(id, key, prompt.kind)}
              className={s.secondaryButton}
            >
              Dismiss
            </button>
            {prompt.kind === 'choose' && (
              <>
                <button
                  type="button"
                  onClick={() => answer(key, prompt, 'project')}
                  className={s.secondaryButton}
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => answer(key, prompt, prompt.mine)}
                  className={s.primaryButton}
                >
                  Use mine
                </button>
              </>
            )}
            {prompt.kind === 'overridden' && (
              <button
                type="button"
                onClick={() => answer(key, prompt, 'project')}
                className={s.primaryButton}
              >
                Use project key
              </button>
            )}
            {prompt.kind === 'rejected' && (
              <button
                type="button"
                onClick={() => answer(key, prompt, prompt.mine)}
                className={s.primaryButton}
              >
                Use my {SOURCE_NAMES[prompt.mine]} key
              </button>
            )}
          </div>
        </div>
      ))}
    </div>,
    document.body
  )
}
