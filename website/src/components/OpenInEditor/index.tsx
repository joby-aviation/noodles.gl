import clsx from 'clsx'
import type { ReactNode } from 'react'

import styles from './styles.module.css'

// The editor is a separate app served from /app on the same host, so these are
// plain <a> tags rather than Docusaurus <Link>, which would flag /app as broken.
const APP_PATH = '/app'

export function editorUrl(example?: string): string {
  return example ? `${APP_PATH}/examples/${example}` : `${APP_PATH}/`
}

// The examples most people open first. Ids are folder names under
// noodles-editor/src/examples/.
export const startExamples = [
  {
    id: 'world-flights',
    title: 'World Flights',
    description: 'flight paths replayed over a timeline, colored by country.',
  },
  {
    id: 'california-earthquakes',
    title: 'California Earthquakes',
    description: 'points sized and colored by magnitude, loaded from a CSV.',
  },
  {
    id: 'nyc-taxis',
    title: 'NYC Taxis',
    description: 'arcs from pickup to dropoff for about 100,000 taxi trips.',
  },
]

function trackClick(example: string | undefined, placement: string) {
  try {
    const props = {
      example: example ?? null,
      placement,
      path: window.location.pathname,
    }
    const w = window as Window & {
      posthog?: { capture: (event: string, props?: object) => void }
      gtag?: (...args: unknown[]) => void
    }
    w.posthog?.capture('docs_open_editor_clicked', props)
    w.gtag?.('event', 'docs_open_editor_clicked', props)
  } catch {
    // Analytics must never block the link
  }
}

type OpenInEditorProps = {
  // Example id to open. Leave out to open the editor's start screen.
  example?: string
  // Button text
  label?: string
  // Optional text shown before the button
  children?: ReactNode
}

// A callout with one button into the editor. Any doc page can use it as
// <OpenInEditor /> or <OpenInEditor example="nyc-taxis">Some text</OpenInEditor>.
export default function OpenInEditor({ example, label, children }: OpenInEditorProps): ReactNode {
  const text = label ?? (example ? 'Open this example in the editor' : 'Open the editor')
  return (
    <div className={styles.callout}>
      {children && <div className={styles.text}>{children}</div>}
      <a
        className={clsx('button button--primary', styles.button)}
        href={editorUrl(example)}
        onClick={() => trackClick(example, 'callout')}
      >
        {text}
      </a>
    </div>
  )
}

type EditorLinkProps = {
  example?: string
  children: ReactNode
}

// An inline text link into the editor or one of its examples.
export function EditorLink({ example, children }: EditorLinkProps): ReactNode {
  return (
    <a href={editorUrl(example)} onClick={() => trackClick(example, 'inline')}>
      {children}
    </a>
  )
}

// The starter examples as a list, each opening in the editor.
export function StartExamples(): ReactNode {
  return (
    <ul>
      {startExamples.map(ex => (
        <li key={ex.id}>
          <a href={editorUrl(ex.id)} onClick={() => trackClick(ex.id, 'example-list')}>
            <strong>{ex.title}</strong>
          </a>
          : {ex.description}
        </li>
      ))}
    </ul>
  )
}
