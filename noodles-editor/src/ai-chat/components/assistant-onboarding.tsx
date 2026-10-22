import { useState } from 'react'
// The website's "Use with your AI agent" section copies the same prompts
import agentPrompt from '../../../../website/static/agent-prompt.txt?raw'
import claudeCodePrompt from '../../../../website/static/claude-code-prompt.txt?raw'
import type { OpenRouterConnect } from '../../noodles/use-openrouter-connect'
import { analytics } from '../../utils/analytics'
import styles from './assistant-onboarding.module.css'

interface AssistantOnboardingProps {
  connect: Pick<OpenRouterConnect, 'status' | 'error' | 'blockedUrl' | 'connect' | 'retryPopup'>
  webgpuReady: boolean
  openProviderSettings: () => void
  onClose: () => void
  freeModels: Array<{ label: string }>
}

export function AssistantOnboarding({
  connect,
  webgpuReady,
  openProviderSettings,
  onClose,
  freeModels,
}: AssistantOnboardingProps) {
  const freeModelName = freeModels[0]?.label ?? 'a free model'
  const [promptCopy, setPromptCopy] = useState<{
    agent: 'claude_code' | 'other'
    status: 'copied' | 'failed'
  } | null>(null)

  const copyPrompt = async (agent: 'claude_code' | 'other') => {
    try {
      await navigator.clipboard.writeText(agent === 'claude_code' ? claudeCodePrompt : agentPrompt)
      setPromptCopy({ agent, status: 'copied' })
      analytics.track('agent_prompt_copied', { agent, source: 'assistant_onboarding' })
    } catch {
      setPromptCopy({ agent, status: 'failed' })
    }
  }
  const copied = (agent: 'claude_code' | 'other') =>
    promptCopy?.agent === agent && promptCopy.status === 'copied'
  const failedHref =
    promptCopy?.agent === 'other'
      ? 'https://noodles.gl/agent-prompt.txt'
      : 'https://noodles.gl/claude-code-prompt.txt'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Connect an AI provider</h3>
        <p className={styles.subtitle}>The assistant needs an LLM to answer questions</p>
      </div>

      <div className={styles.cardsContainer}>
        {/* OpenRouter Card - Primary Option */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h4 className={styles.cardTitle}>OpenRouter</h4>
          </div>
          <p className={styles.cardDescription}>
            Cloud service with free tier. 50 messages/day on {freeModelName}, no credit card needed.
            Sign in with GitHub, Google, or email.
          </p>
          <button
            type="button"
            onClick={connect.connect}
            className={styles.primaryButton}
            disabled={connect.status === 'connecting'}
          >
            {connect.status === 'connecting' ? 'Connecting...' : 'Connect with OpenRouter'}
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

        {/* WebLLM Card - Secondary Option */}
        {webgpuReady && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h4 className={styles.cardTitle}>Local model</h4>
            </div>
            <p className={styles.cardDescription}>
              Runs entirely on your device. Requires a one-time download (0.9–5.6 GB) and a GPU.
              Nothing sent to any server.
            </p>
            <button type="button" onClick={openProviderSettings} className={styles.secondaryButton}>
              Choose a model
            </button>
          </div>
        )}

        {/* Coding Agent Card - Tertiary Option */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h4 className={styles.cardTitle}>Use your coding agent</h4>
          </div>
          <p className={styles.cardDescription}>
            Paste this prompt into Claude Code, Codex, Gemini CLI, Cursor, or another agent. It
            installs Noodles.gl on your computer, opens an example map, changes it, and shows you a
            screenshot. Then your agent can edit and export your maps.
          </p>
          <button
            type="button"
            onClick={() => copyPrompt('claude_code')}
            className={styles.tertiaryButton}
          >
            {copied('claude_code')
              ? 'Copied. Paste it into Claude Code'
              : 'Copy Claude Code prompt'}
          </button>
          <button
            type="button"
            onClick={() => copyPrompt('other')}
            className={`${styles.linkButton} ${styles.otherAgentButton}`}
          >
            {copied('other')
              ? 'Copied. Paste it into your agent'
              : 'Copy the prompt for other agents'}
          </button>
          {promptCopy?.status === 'failed' && (
            <p className={styles.errorText}>
              Your browser blocked the copy. The prompt is at{' '}
              <a href={failedHref} target="_blank" rel="noreferrer">
                {failedHref.replace('https://', '')}
              </a>
            </p>
          )}
        </div>
      </div>

      {/* Footer Option - Bring Your Own Key */}
      <div className={styles.footer}>
        <p className={styles.footerText}>
          Have an API key?{' '}
          <button type="button" onClick={openProviderSettings} className={styles.linkButton}>
            Configure Anthropic or OpenAI
          </button>
        </p>
      </div>

      {/* Close Button */}
      <div className={styles.closeContainer}>
        <button type="button" onClick={onClose} className={styles.closeButton}>
          Close
        </button>
      </div>
    </div>
  )
}
