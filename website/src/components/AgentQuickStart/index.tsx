import useBrokenLinks from '@docusaurus/useBrokenLinks'
// The editor's assistant onboarding imports the same files
import agentPrompt from '@site/static/agent-prompt.txt?raw'
import claudeCodePrompt from '@site/static/claude-code-prompt.txt?raw'
import Heading from '@theme/Heading'
import TabItem from '@theme/TabItem'
import Tabs from '@theme/Tabs'
import clsx from 'clsx'
import { type ReactNode, useState } from 'react'

import styles from './styles.module.css'

declare global {
  interface Window {
    posthog?: { capture: (event: string, props?: object) => void }
    gtag?: (...args: unknown[]) => void
  }
}

type Agent = 'claude_code' | 'other'

function trackCopy(agent: Agent) {
  try {
    window.posthog?.capture('agent_prompt_copied', { agent, location: 'landing' })
    window.gtag?.('event', 'agent_prompt_copied', { agent, location: 'landing' })
  } catch {
    // Analytics must never break the copy
  }
}

function PromptBox({
  agent,
  prompt,
  href,
  requirements,
}: {
  agent: Agent
  prompt: string
  href: string
  requirements: string
}): ReactNode {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setStatus('copied')
      trackCopy(agent)
    } catch {
      setStatus('failed')
    }
  }

  return (
    <>
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
          : requirements}{' '}
        For agents: <a href="/llms.txt">llms.txt</a> and the <a href={href}>prompt as text</a>.
      </p>
    </>
  )
}

export default function AgentQuickStart(): ReactNode {
  // The docs link here, and the build only checks anchors it was told about
  useBrokenLinks().collectAnchor('ai-agents')
  return (
    <section id="ai-agents" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <Heading as="h2" className={styles.title}>
            Use with your AI agent
          </Heading>
          <p className={styles.subtitle}>
            Paste one prompt into your coding agent. It installs Noodles.gl, opens an example map,
            changes it, and shows you a screenshot. About 3 minutes.{' '}
            <a href="/users/ai-agents">Other ways to use Noodles with an agent</a>.
          </p>
        </div>
        <div className={styles.tabs}>
          <Tabs groupId="coding-agent">
            <TabItem value="claude-code" label="Claude Code" default>
              <PromptBox
                agent="claude_code"
                prompt={claudeCodePrompt}
                href="/claude-code-prompt.txt"
                requirements="Needs Claude Code, git, Node 22 or later, and Chrome or Edge."
              />
            </TabItem>
            <TabItem value="other" label="Codex, Gemini CLI, Cursor, others">
              <PromptBox
                agent="other"
                prompt={agentPrompt}
                href="/agent-prompt.txt"
                requirements="Needs an agent that can run shell commands and use MCP servers, plus git, Node 22 or later, and Chrome or Edge. Most agents need one restart partway through; the prompt tells you when."
              />
            </TabItem>
          </Tabs>
        </div>
      </div>
    </section>
  )
}
