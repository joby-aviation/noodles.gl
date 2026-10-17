import styles from './assistant-onboarding.module.css'

interface AssistantOnboardingProps {
  connect: {
    status: 'idle' | 'connecting' | 'connected' | 'error'
    error: string | null
    blockedUrl: string | null
    connect: () => void
  }
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
  const freeModelName = freeModels.length > 0 ? freeModels[0].label : 'qwen2.5'

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
            Cloud service with free tier. 50 messages/day on {freeModelName}, no credit card
            needed. Sign in with GitHub, Google, or email.
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
              <a href={connect.blockedUrl} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
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
            <button
              type="button"
              onClick={openProviderSettings}
              className={styles.secondaryButton}
            >
              Choose a model
            </button>
          </div>
        )}
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
