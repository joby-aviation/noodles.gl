import { useState } from 'react'
// The website's "Use with your AI agent" section copies the same prompts
import agentPrompt from '../../../../website/static/agent-prompt.txt?raw'
import claudeCodePrompt from '../../../../website/static/claude-code-prompt.txt?raw'
import type { OpenRouterConnect } from '../../noodles/use-openrouter-connect'
import { analytics } from '../../utils/analytics'
import { useAgentModelStore } from '../agent/model-store'
import { formatGb, WEBLLM_MODELS } from '../agent/providers/webllm'
import styles from './assistant-onboarding.module.css'

// Quality first: it is the default and the only one that reliably makes edits.
// The compatibility models stay in Settings for GPUs that cannot hold these.
const LOCAL_MODELS = (['quality', 'fast'] as const).flatMap(tier =>
  WEBLLM_MODELS.filter(model => model.tier === tier).map(model => ({
    ...model,
    tierLabel: tier === 'quality' ? 'Quality' : 'Fast',
    name: model.label.replace(/^Local \w+: /, ''),
  }))
)

interface AssistantOnboardingProps {
  connect: Pick<OpenRouterConnect, 'status' | 'error' | 'blockedUrl' | 'connect' | 'retryPopup'>
  webgpuReady: boolean
  openProviderSettings: () => void
  onClose: () => void
}

export function AssistantOnboarding({
  connect,
  webgpuReady,
  openProviderSettings,
  onClose,
}: AssistantOnboardingProps) {
  const setModel = useAgentModelStore(state => state.setModel)
  const [promptCopy, setPromptCopy] = useState<{
    agent: 'claude_code' | 'other'
    status: 'copied' | 'failed'
  } | null>(null)

  // Choosing a model is what arms the local provider, so this one click both picks
  // it and starts the download the button names
  const chooseLocalModel = (model: string) => {
    setModel('webllm', model)
    analytics.track('webllm_model_selected', { model, source: 'assistant_onboarding' })
  }

  const copyPrompt = async (agent: 'claude_code' | 'other') => {
    try {
      await navigator.clipboard.writeText(agent === 'claude_code' ? claudeCodePrompt : agentPrompt)
      setPromptCopy({ agent, status: 'copied' })
      analytics.track('agent_prompt_copied', { agent, source: 'assistant_onboarding' })
    } catch {
      setPromptCopy({ agent, status: 'failed' })
    }
  }
  const failedHref =
    promptCopy?.agent === 'other'
      ? 'https://noodles.gl/agent-prompt.txt'
      : 'https://noodles.gl/claude-code-prompt.txt'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Connect an AI provider</h3>
        <p className={styles.subtitle}>Pick a model for the assistant to use</p>
      </div>

      <div className={styles.cardsContainer}>
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>OpenRouter</h4>
          <p className={styles.cardDescription}>
            Hosted models. The free tier allows 50 messages a day.
          </p>
          <button
            type="button"
            onClick={connect.connect}
            className={styles.primaryButton}
            disabled={connect.status === 'connecting'}
          >
            {connect.status === 'connecting' ? 'Connecting...' : 'Connect OpenRouter'}
          </button>
          {connect.blockedUrl && (
            <p className={styles.errorText}>
              Browser blocked the sign-in window.{' '}
              {/* A button, not a link: a tab opened from a link has no opener to
                  post the key back to and no copy of the verifier */}
              <button type="button" onClick={connect.retryPopup} className={styles.linkButton}>
                Open it again
              </button>
            </p>
          )}
          {connect.error && <p className={styles.errorText}>{connect.error}</p>}
        </div>

        {webgpuReady && (
          <div className={styles.card}>
            <h4 className={styles.cardTitle}>Local model</h4>
            <p className={styles.cardDescription}>
              Runs on your GPU and nothing leaves the browser. Slower than hosted models.
            </p>
            <div className={styles.modelButtons}>
              {LOCAL_MODELS.map(model => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => chooseLocalModel(model.id)}
                  className={styles.secondaryButton}
                >
                  <span className={styles.modelTier}>{model.tierLabel}</span>
                  <span className={styles.modelMeta}>
                    {model.name}, {formatGb(model.downloadMb)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <p className={styles.footerText}>
          Have an API key?{' '}
          <button type="button" onClick={openProviderSettings} className={styles.linkButton}>
            Add it in Settings
          </button>
        </p>
        <p className={styles.footerText}>
          Using a coding agent? Copy the setup prompt for{' '}
          <button
            type="button"
            onClick={() => copyPrompt('claude_code')}
            className={styles.linkButton}
          >
            Claude Code
          </button>{' '}
          or{' '}
          <button type="button" onClick={() => copyPrompt('other')} className={styles.linkButton}>
            other agents
          </button>
        </p>
        {promptCopy?.status === 'copied' && (
          <p className={styles.footerText} role="status">
            Copied. Paste it into{' '}
            {promptCopy.agent === 'claude_code' ? 'Claude Code' : 'your agent'}
          </p>
        )}
        {promptCopy?.status === 'failed' && (
          <p className={styles.errorText}>
            Your browser blocked the copy. The prompt is at{' '}
            <a href={failedHref} target="_blank" rel="noreferrer">
              {failedHref.replace('https://', '')}
            </a>
          </p>
        )}
      </div>

      <div className={styles.closeContainer}>
        <button type="button" onClick={onClose} className={styles.closeButton}>
          Close
        </button>
      </div>
    </div>
  )
}
