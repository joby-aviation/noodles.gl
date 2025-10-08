import { basename } from 'node:path'

const projects = import.meta.glob(['../public/noodles/*.json'])

export default function NotFound() {
  return (
    <div className="not-found">
      <h1>Not Found</h1>
      <h2>
        Options:
        <ul>
          {Object.keys(projects).map(projectId => {
            const projectName = basename(projectId, '.json')
            return (
              <li key={`${projectName}`}>
                <a href={`?project=${projectName}`}>project: {projectName}</a>
              </li>
            )
          })}
        </ul>
      </h2>
    </div>
  )
}
