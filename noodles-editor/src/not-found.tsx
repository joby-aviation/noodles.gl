import { basename, dirname } from 'node:path'
import s from './not-found.module.css'

const rootProjects = import.meta.glob('../public/noodles/*.json')
const nestedProjects = import.meta.glob('../public/noodles/**/noodles.json')

const projects = {...rootProjects, ...nestedProjects}

export default function NotFound() {
  return (
    <div className={s.notFound}>
      <h1>Not Found</h1>
      <h2>
        Options:
        <ul>
          {Object.keys(projects).map(path => {
            const base = basename(path, '.json')
            const projectName = base === 'noodles' ? basename(dirname(path)) : base
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
