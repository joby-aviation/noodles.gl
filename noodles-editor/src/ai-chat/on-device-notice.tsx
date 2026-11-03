// The nudge from an on-device model towards a hosted one. On-device is free and
// private, and it is also several times slower than a hosted model and too small
// to build a graph from scratch (bench/agent/results). A user finds that out the
// slow way unless the panel says so, and says what to do about it.
//
// Two variants: a dismissible banner above the conversation, and a line inside a
// reply that is taking long, which shows even after the banner was dismissed
// because that is the moment the advice is about.

import type { FC } from 'react'
import styles from './chat-panel.module.css'

const DISMISSED_KEY = 'noodles-on-device-notice-dismissed'

// How long a reply runs before the in-reply variant appears. A hosted model has
// usually answered by now; an on-device one on a laptop often has not.
export const SLOW_REPLY_MS = 20_000

export function onDeviceNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissOnDeviceNotice() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Storage blocked: the banner comes back next time, which is harmless
  }
}

interface OnDeviceNoticeProps {
  variant: 'banner' | 'slow-reply'
  // The hosted provider that is already set up, if any, so the offer is a switch
  // rather than a trip to Settings
  cloudLabel: string | null
  onUseCloud: () => void
  onDismiss?: () => void
}

export const OnDeviceNotice: FC<OnDeviceNoticeProps> = ({
  variant,
  cloudLabel,
  onUseCloud,
  onDismiss,
}) => (
  <div
    className={variant === 'banner' ? styles.onDeviceNotice : styles.onDeviceNoticeInline}
    role="note"
  >
    <span>
      {variant === 'banner'
        ? 'On-device models take 10 seconds to a minute per answer, and handle questions and small edits better than whole builds. A cloud model answers in seconds.'
        : 'On-device models are slow on multi-step requests.'}{' '}
      <strong>Too slow?</strong>
    </span>
    <button type="button" className={styles.onDeviceNoticeAction} onClick={onUseCloud}>
      {cloudLabel ? `Switch to ${cloudLabel}` : 'Set up a cloud model'}
    </button>
    {onDismiss && (
      <button
        type="button"
        className={styles.onDeviceNoticeDismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ✕
      </button>
    )}
  </div>
)
