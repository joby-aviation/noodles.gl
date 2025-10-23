import { basename, dirname } from 'node:path'
import { useEffect, useState } from 'react'
import s from './examples-page.module.css'

const projects = import.meta.glob('../public/examples/**/noodles.json')
const readmes = import.meta.glob('../public/examples/**/README.md', { query: '?raw', import: 'default' })

interface ExampleProject {
  name: string
  path: string
  readme?: string
}

export default function ExamplesPage() {
  const [examples, setExamples] = useState<ExampleProject[]>([])

  useEffect(() => {
    const loadExamples = async () => {
      const examplesList: ExampleProject[] = []

      for (const path of Object.keys(projects)) {
        const projectName = basename(dirname(path))
        const readmePath = path.replace('noodles.json', 'README.md')

        let readme: string | undefined
        if (readmes[readmePath]) {
          try {
            readme = await readmes[readmePath]() as string
          } catch (e) {
            console.warn(`Failed to load README for ${projectName}`, e)
          }
        }

        examplesList.push({
          name: projectName,
          path: `/examples/${projectName}`,
          readme
        })
      }

      // Sort alphabetically
      examplesList.sort((a, b) => a.name.localeCompare(b.name))
      setExamples(examplesList)
    }

    loadExamples()
  }, [])

  const extractDescription = (readme?: string): string => {
    if (!readme) return ''

    // Extract first paragraph after the title that doesn't start with underscore
    // (We use underscore to denote that a line is metadata/example info, not description)
    const lines = readme.split('\n')
    let foundTitle = false
    let description = ''

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('#')) {
        foundTitle = true
        continue
      }

      // Skip empty lines
      if (!trimmed) {
        continue
      }

      // Found a non-empty line after title
      if (foundTitle) {
        // Skip lines starting with underscore (metadata)
        if (trimmed.startsWith('_')) {
          continue
        }

        // This is our description
        description = trimmed
        break
      }
    }

    return description
  }

  return (
    <div className={s.examplesPage}>
      <h1>Examples</h1>
      <p>Explore example projects showcasing different visualizations and data processing techniques.</p>
      <div className={s.examplesGrid}>
        {examples.map(example => {
          const description = extractDescription(example.readme)
          return (
            <div key={example.name} className={s.exampleCard}>
              <h3>
                <a
                  href={example.path}
                  onClick={(e) => {
                    e.preventDefault()
                    window.history.pushState({}, '', example.path)
                    window.dispatchEvent(new PopStateEvent('popstate'))
                  }}
                >
                  {example.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </a>
              </h3>
              {description && <p>{description}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
