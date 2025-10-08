import s from '../noodles.module.css'
import menu from './menu.module.css'

export const UNSAVED_PROJECT_NAME = 'Untitled'
export function ProjectNameBar({ projectName }: { projectName?: string }) {
  return (
    <div className={s.projectNameBar}>
      <div className={menu.menubarTrigger}>{projectName || UNSAVED_PROJECT_NAME}</div>
    </div>
  )
}
