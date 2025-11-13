import { basename, dirname } from 'node:path'
import { Link } from 'wouter'
import s from './not-found.module.css'

const projects = import.meta.glob('../public/examples/**/noodles.json')

export default function NotFound() {
  return (
    <div className={s.notFound}>
      <h1>Not Found</h1>
      <h2>
        Options:
        <ul>
          {Object.keys(projects).map(path => {
            const projectName = basename(dirname(path))
            return (
              <li key={`${projectName}`}>
                <Link href={`/project/${projectName.toLowerCase()}`}>project: {projectName}</Link>
              </li>
            )
          })}
        </ul>
      </h2>
    </div>
  )
}
