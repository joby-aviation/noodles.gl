import { useEffect, useState } from 'react'
import s from './analytics-consent-banner.module.css'
import { analytics } from '../utils/analytics'

export function AnalyticsConsentBanner() {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Only show banner if user hasn't made a choice yet
    const hasSeenPrompt = analytics.hasSeenConsentPrompt()
    setShowBanner(!hasSeenPrompt)
  }, [])

  const handleAccept = () => {
    analytics.setConsent(true)
    analytics.track('analytics_consent_accepted')
    setShowBanner(false)
  }

  const handleDecline = () => {
    analytics.setConsent(false)
    setShowBanner(false)
  }

  if (!showBanner) {
    return null
  }

  return (
    <div className={s.banner}>
      {/* Speech bubble arrow pointing up toward logo */}
      <div className={s.arrow} />
      <div className={s.arrowFill} />

      <p className={s.text}>
        <strong>Help improve Noodles</strong>
        <br />
        <span className={s.secondaryText}>
          We use privacy-preserving analytics. No personal data collected.{' '}
          <a
            href="https://noodles.gl/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className={s.link}
          >
            Learn more
          </a>
        </span>
      </p>
      <div className={s.actions}>
        <button type="button" onClick={handleDecline} className={s.declineButton}>
          Decline
        </button>
        <button type="button" onClick={handleAccept} className={s.acceptButton}>
          Accept
        </button>
      </div>
    </div>
  )
}
