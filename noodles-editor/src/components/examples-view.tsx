import { basename, dirname } from 'node:path'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeftIcon } from '@radix-ui/react-icons'
import { useCallback, useMemo } from 'react'
import { useLocation } from 'wouter'
import type { NoodlesProjectJSON } from '../noodles/utils/serialization'
import { analytics } from '../utils/analytics'
import s from './quick-start-modal.module.css'

// Vite glob imports for examples
const exampleProjects = import.meta.glob<NoodlesProjectJSON>('../examples/**/noodles.json', {
  eager: true,
  import: 'default',
})
const exampleReadmes = import.meta.glob('../examples/**/README.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

export interface ExampleProject {
  id: string
  name: string
  path: string
  description?: string
}

function extractDescription(readme?: string): string {
  if (!readme) return ''
  const lines = readme.split('\n')
  let foundTitle = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      foundTitle = true
      continue
    }
    if (!trimmed) continue
    if (foundTitle) {
      if (trimmed.startsWith('_')) continue
      return trimmed
    }
  }
  return ''
}

// Hook to get all examples
export function useAllExamples(): ExampleProject[] {
  return useMemo<ExampleProject[]>(() => {
    const list: ExampleProject[] = []
    for (const [path, projectJson] of Object.entries(exampleProjects)) {
      const projectId = basename(dirname(path))
      const readmePath = path.replace('noodles.json', 'README.md')
      const readme = exampleReadmes[readmePath] as string | undefined

      list.push({
        id: projectId,
        name: projectJson.name || projectId,
        path: `/examples/${projectId}`,
        description: extractDescription(readme),
      })
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [])
}

// Curated examples for home view
export const CURATED_EXAMPLES = [
  {
    id: 'world-flights',
    title: 'World Flights',
    description: 'Animated flight trajectories across the globe',
    icon: 'pi-globe',
  },
  {
    id: 'california-earthquakes',
    title: 'California Earthquakes',
    description: 'Seismic activity with magnitude-driven styling',
    icon: 'pi-chart-scatter',
  },
  {
    id: 'nyc-taxis',
    title: 'NYC Taxis',
    description: 'Taxi trips showing pickup to dropoff flows',
    icon: 'pi-car',
  },
  {
    id: 'sf-street-trees',
    title: 'SF Street Trees',
    description: 'Urban forest inventory across San Francisco',
    icon: 'pi-sitemap',
  },
]

interface ExamplesViewProps {
  onBack?: () => void
  onClose: () => void
}

export function ExamplesView({ onBack, onClose }: ExamplesViewProps) {
  const [, navigate] = useLocation()
  const allExamples = useAllExamples()

  const handleExampleClick = useCallback(
    (exampleId: string) => {
      analytics.track('quick_start_example_selected', { example: exampleId })
      onClose()
      navigate(`/examples/${exampleId}`)
    },
    [navigate, onClose]
  )

  return (
    <>
      {/* Show view header only in standalone mode (with back button) */}
      {onBack && (
        <div className={s.viewHeader}>
          <button type="button" className={s.backButton} onClick={onBack}>
            <ChevronLeftIcon width={16} height={16} />
            Back
          </button>
          <Dialog.Title className={s.viewTitle}>Examples</Dialog.Title>
          <Dialog.Description className={s.viewSubtitle}>
            Explore example projects showcasing different visualizations
          </Dialog.Description>
        </div>
      )}

      <div className={s.body}>
        <div className={s.fullGrid}>
          {allExamples.map(example => (
            <button
              key={example.id}
              type="button"
              className={s.projectCard}
              onClick={() => handleExampleClick(example.id)}
            >
              <div className={s.projectInfo}>
                <h4>{example.name}</h4>
                {example.description && <p>{example.description}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
