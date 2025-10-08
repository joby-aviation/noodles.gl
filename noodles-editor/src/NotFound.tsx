import { basename, dirname } from 'node:path'

const rootProjects = import.meta.glob('../public/noodles/*.json')
const nestedProjects = import.meta.glob('../public/noodles/**/noodles.json')

const projects = {...rootProjects, ...nestedProjects}

console.log('Available projects:', Object.keys(projects))

export default function NotFound() {
  return (
    <div className="not-found">
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
