import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useState } from 'react'
import { listProjects } from '../storage/workspace-storage'
import type { Workspace } from '../storage/workspace-types'
import s from './menu.module.css'

interface ProjectListDialogProps {
  workspace: Workspace
  prompt?: string
  onComplete: (projectName: string | null) => void
}

export function ProjectListDialog({ workspace, prompt, onComplete }: ProjectListDialogProps) {
  const [projects, setProjects] = useState<string[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const projectList = await listProjects(workspace)
        setProjects(projectList)
        setIsLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects')
        setIsLoading(false)
      }
    }
    loadProjects()
  }, [workspace])

  const handleSelect = useCallback(() => {
    if (selectedProject) {
      onComplete(selectedProject)
    }
  }, [selectedProject, onComplete])

  return (
    <Dialog.Root open onOpenChange={open => !open && onComplete(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent} style={{ maxWidth: 500 }}>
          <Dialog.Title className={s.dialogTitle}>
            {prompt || `Select Project from ${workspace.name}`}
          </Dialog.Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {isLoading && (
              <p style={{ color: 'var(--mauve-11)', margin: 0 }}>Loading projects...</p>
            )}

            {error && <p className={s.dialogError}>{error}</p>}

            {!isLoading && !error && projects.length === 0 && (
              <p style={{ color: 'var(--mauve-11)', margin: 0 }}>
                No projects found in this workspace.
              </p>
            )}

            {!isLoading && !error && projects.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {projects.map(name => (
                  <div
                    key={name}
                    role="button"
                    tabIndex={0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      backgroundColor: selectedProject === name ? 'var(--mauve-4)' : 'transparent',
                    }}
                    onClick={() => setSelectedProject(name)}
                    onKeyDown={e => e.key === 'Enter' && setSelectedProject(name)}
                  >
                    <input
                      type="radio"
                      checked={selectedProject === name}
                      onChange={() => setSelectedProject(name)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={s.dialogRightSlot} style={{ marginTop: '1rem' }}>
            <button type="button" className={s.dialogButton} onClick={() => onComplete(null)}>
              Cancel
            </button>
            {selectedProject && (
              <button type="button" className={s.dialogButton} onClick={handleSelect}>
                Open {selectedProject}
              </button>
            )}
          </div>

          <Dialog.Close asChild>
            <button type="button" className={s.dialogIconButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
