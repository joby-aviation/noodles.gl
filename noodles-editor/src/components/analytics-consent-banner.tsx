import { useState, useEffect } from 'react';
import { analytics } from '../utils/analytics';

export function AnalyticsConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Only show banner if user hasn't made a choice yet
    const hasSeenPrompt = analytics.hasSeenConsentPrompt();
    setShowBanner(!hasSeenPrompt);
  }, []);

  const handleAccept = () => {
    analytics.setConsent(true);
    analytics.track('analytics_consent_accepted');
    setShowBanner(false);
  };

  const handleDecline = () => {
    analytics.setConsent(false);
    setShowBanner(false);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        color: 'white',
        padding: '1rem 1.5rem',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: '300px' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5' }}>
          <strong>Help improve Noodles.gl</strong>
          <br />
          We use privacy-preserving analytics to understand which features are most useful.
          We never collect your project data, node content, or personal information.
          You can change this anytime in settings.
          {' '}
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
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          onClick={handleDecline}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: 'transparent',
            color: 'white',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#4338ca';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#4f46e5';
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
