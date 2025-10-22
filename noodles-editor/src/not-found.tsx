import { basename, dirname } from 'node:path'
import s from './not-found.module.css'

const projects = import.meta.glob('../public/noodles/**/noodles.json')

export default function NotFound() {
  return (
    <div className={s.notFound}>
      <h1>Not Found</h1>
      <h2>
        Options:
        <ul>
          {Object.keys(projects).map(path => {
            const projectName = basename(dirname(path))
            // Filter out 'new' as it's a special template project
            if (projectName === 'new') return null
            return (
              <li key={`${projectName}`}>
                <a href={`?project=${projectName.toLowerCase()}`}>project: {projectName}</a>
              </li>
            )
          })}
        </ul>
      </h2>
    </div>
  )
}
