import Heading from '@theme/Heading'
import clsx from 'clsx'
import { type ReactNode, useState } from 'react'
// The editor's assistant onboarding imports the same file
import prompt from '@site/static/claude-code-prompt.txt?raw'

import styles from './styles.module.css'

declare global {
  interface Window {
    posthog?: { capture: (event: string, props?: object) => void }
    gtag?: (...args: unknown[]) => void
  }
}

function trackCopy() {
  try {
    window.posthog?.capture('claude_code_prompt_copied', { location: 'landing' })
    window.gtag?.('event', 'claude_code_prompt_copied', { location: 'landing' })
  } catch {
    // Analytics must never break the copy
  }
}

export default function ClaudeCodeQuickStart(): ReactNode {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setStatus('copied')
      trackCopy()
    } catch {
      setStatus('failed')
    }
  }

  return (
    <section id="claude-code" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <Heading as="h2" className={styles.title}>
            Use with Claude Code
          </Heading>
          <p className={styles.subtitle}>
            Paste one prompt into Claude Code. It installs Noodles.gl, opens an example map, changes
            it, and shows you a screenshot. About 3 minutes.
          </p>
        </div>
        <div className={styles.promptBox}>
          <div className={styles.promptBar}>
            <span className={styles.promptLabel}>Prompt</span>
            <button
              type="button"
              className={clsx('button button--primary', styles.copyButton)}
              onClick={copy}
            >
              {status === 'copied' ? 'Copied' : 'Copy prompt'}
            </button>
          </div>
          <pre className={styles.promptText}>{prompt}</pre>
        </div>
        <p className={styles.note} aria-live="polite">
          {status === 'failed'
            ? 'Your browser blocked the copy. Select the text above and copy it.'
            : 'Needs Claude Code, git, Node 22 or later, and Chrome or Edge.'}{' '}
          For agents: <a href="/llms.txt">llms.txt</a> and the{' '}
          <a href="/claude-code-prompt.txt">prompt as text</a>.
        </p>
      </div>
    </section>
  )
}
