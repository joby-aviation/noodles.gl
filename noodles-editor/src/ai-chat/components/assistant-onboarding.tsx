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
        <h3 className={styles.title}>Get started with the Assistant</h3>
        <p className={styles.subtitle}>Choose how you'd like to connect</p>
      </div>

      <div className={styles.cardsContainer}>
        {/* OpenRouter Card - Primary Option */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h4 className={styles.cardTitle}>Free cloud AI</h4>
          </div>
          <ul className={styles.benefitsList}>
            <li>50 free messages daily</li>
            <li>No credit card required</li>
            <li>Works immediately</li>
          </ul>
          <p className={styles.cardNote}>
            Starts on free model ({freeModelName}). Adding credit later lifts limits without
            changing anything here.
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
              <a href={connect.blockedUrl} target="_blank" rel="noopener noreferrer">
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
              <h4 className={styles.cardTitle}>Private local AI</h4>
            </div>
            <ul className={styles.benefitsList}>
              <li>100% private</li>
              <li>Runs offline</li>
              <li>Never leaves your browser</li>
            </ul>
            <p className={styles.cardNote}>One-time download: 0.9–5.6 GB depending on model</p>
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
          Already have Anthropic or OpenAI?{' '}
          <button type="button" onClick={openProviderSettings} className={styles.linkButton}>
            Configure API key →
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
