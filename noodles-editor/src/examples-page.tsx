import { basename, dirname } from 'node:path'
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import s from './examples-page.module.css'

const projects = import.meta.glob('./examples/**/noodles.json')
const readmes = import.meta.glob('./examples/**/README.md', {
  query: '?raw',
  import: 'default',
})

interface ExampleProject {
  name: string
  path: string
  readme?: string
}

const ACRONYMS: Record<string, string> = {
  nyc: 'NYC',
  usa: 'USA',
  uk: 'UK',
  api: 'API',
  json: 'JSON',
  csv: 'CSV',
}

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

export default function ExamplesPage() {
  const [examples, setExamples] = useState<ExampleProject[]>([])

  useEffect(() => {
    const loadExamples = async () => {
      const examplesList: ExampleProject[] = []

      for (const path of Object.keys(projects)) {
        const projectId = basename(dirname(path))
        const readmePath = path.replace('noodles.json', 'README.md')

        let projectName = projectId

        let readme: string | undefined
        if (readmes[readmePath]) {
          try {
            readme = (await readmes[readmePath]()) as string
            if (readme) {
              // parse first line for project name as "# Project Name"
              const firstLine = readme.split('\n')[0]
              const match = firstLine.match(/^#\s+(.*)/)
              if (match?.[1]) {
                projectName = match[1].trim()
              }
            }
          } catch (e) {
            console.warn(`Failed to load README for ${projectName}`, e)
          }
        }

        examplesList.push({
          name: projectName,
          path: `/examples/${projectId}`,
          readme,
        })
      }

      // Sort alphabetically
      examplesList.sort((a, b) => a.name.localeCompare(b.name))
      setExamples(examplesList)
    }

    loadExamples()
  }, [])

  return (
    <div className={s.examplesPage} data-testid="examples-page">
      <h1>Examples</h1>
      <p>
        Explore example projects showcasing different visualizations and data processing techniques.
      </p>
      <div className={s.examplesGrid}>
        {examples.map(example => {
          const description = extractDescription(example.readme)
          return (
            <Link key={example.name} href={example.path} className={s.exampleCard}>
              <h3>
                {example.name
                  .replace(/-/g, ' ')
                  .replace(
                    /\b\w+\b/g,
                    word =>
                      ACRONYMS[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1)
                  )}
              </h3>
              {description && <p>{description}</p>}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
