import { useEffect, useState } from 'react'
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
    <div
      style={{
        position: 'fixed',
        top: 52,
        left: 12,
        backgroundColor: 'var(--color-bg-base, #1a1a1a)',
        color: 'var(--color-text-primary, white)',
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--color-border, rgba(255, 255, 255, 0.1))',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        zIndex: 10000,
        maxWidth: 260,
        fontSize: 12,
      }}
    >
      {/* Speech bubble arrow pointing up toward logo */}
      <div
        style={{
          position: 'absolute',
          top: -6,
          left: 20,
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderBottom: '6px solid var(--color-border, rgba(255, 255, 255, 0.1))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -5,
          left: 20,
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderBottom: '6px solid var(--color-bg-base, #1a1a1a)',
        }}
      />

      <p style={{ margin: '0 0 10px 0', lineHeight: 1.4 }}>
        <strong>Help improve Noodles</strong>
        <br />
        <span style={{ color: 'var(--color-text-secondary, #999)', fontSize: 11 }}>
          We use privacy-preserving analytics. No personal data collected.{' '}
          <a
            href="https://noodles.gl/privacy"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#a5b4fc',
              textDecoration: 'underline',
            }}
          >
            Learn more
          </a>
        </span>
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleDecline}
          style={{
            padding: '5px 10px',
            backgroundColor: 'transparent',
            color: 'var(--color-text-secondary, #999)',
            border: '1px solid var(--color-border, rgba(255, 255, 255, 0.2))',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Decline
        </button>
        <button
          type="button"
          onClick={handleAccept}
          style={{
            padding: '5px 10px',
            backgroundColor: '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Accept
        </button>
      </div>
    </div>
  )
}
