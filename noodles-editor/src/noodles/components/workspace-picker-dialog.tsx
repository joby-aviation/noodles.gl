import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useState } from 'react'
import type { Workspace } from '../storage/workspace-types'
import { getCachedWorkspaces, removeFromCache } from '../utils/workspace-cache'
import s from './menu.module.css'

interface WorkspacePickerDialogProps {
  prompt?: string
  showRecent?: boolean
  onComplete: (workspace: Workspace | null) => void
}

export function WorkspacePickerDialog({
  prompt,
  showRecent = true,
  onComplete,
}: WorkspacePickerDialogProps) {
  const [recentWorkspaces, setRecentWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load recent workspaces on mount
  useEffect(() => {
    const loadRecent = async () => {
      if (showRecent) {
        const cached = await getCachedWorkspaces()
        setRecentWorkspaces(cached)
      }
      setIsLoading(false)
    }
    loadRecent()
  }, [showRecent])

  // Handle opening a folder workspace
  const handleOpenFolder = useCallback(async () => {
    try {
      // Use File System Access API to pick a directory
      const handle = await window.showDirectoryPicker()
      const workspace: Workspace = {
        type: 'folder',
        name: handle.name,
        handle,
      }
      onComplete(workspace)
    } catch (err) {
      // User cancelled or API not supported
      console.warn('Failed to open directory:', err)
    }
  }, [onComplete])

  // Handle selecting browser storage
  const handleBrowserStorage = useCallback(() => {
    const workspace: Workspace = {
      type: 'browserStorage',
      name: 'Browser Storage',
    }
    onComplete(workspace)
  }, [onComplete])

  // Handle selecting examples
  const handleExamples = useCallback(() => {
    const workspace: Workspace = {
      type: 'examples',
      name: 'Examples',
    }
    onComplete(workspace)
  }, [onComplete])

  // Handle selecting a recent workspace
  const handleSelectRecent = useCallback(() => {
    if (selectedWorkspace) {
      onComplete(selectedWorkspace)
    }
  }, [selectedWorkspace, onComplete])

  // Handle removing a workspace from recent list
  const handleRemoveRecent = useCallback(
    async (workspace: Workspace, e: React.MouseEvent) => {
      e.stopPropagation()
      if (workspace.type === 'folder') {
        await removeFromCache(workspace.name)
        const updated = await getCachedWorkspaces()
        setRecentWorkspaces(updated)
        if (selectedWorkspace?.name === workspace.name) {
          setSelectedWorkspace(null)
        }
      }
    },
    [selectedWorkspace]
  )

  return (
    <Dialog.Root open onOpenChange={open => !open && onComplete(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent} style={{ maxWidth: 500 }}>
          <Dialog.Title className={s.dialogTitle}>{prompt || 'Select Workspace'}</Dialog.Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {/* Quick actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>New Workspace</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className={s.dialogButton} onClick={handleOpenFolder}>
                  Open Folder
                </button>
                <button type="button" className={s.dialogButton} onClick={handleBrowserStorage}>
                  Use Browser Storage
                </button>
                <button type="button" className={s.dialogButton} onClick={handleExamples}>
                  Open Examples
                </button>
              </div>
            </div>

            {/* Recent workspaces */}
            {showRecent && recentWorkspaces.length > 0 && (
              <>
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid var(--mauve-6)',
                    margin: '0.5rem 0',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>
                    Recent Workspaces
                  </h3>
                  {isLoading ? (
                    <p style={{ color: 'var(--mauve-11)', margin: 0 }}>Loading...</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {recentWorkspaces.map(workspace => (
                        <div
                          key={workspace.name}
                          role="button"
                          tabIndex={0}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            backgroundColor:
                              selectedWorkspace?.name === workspace.name
                                ? 'var(--mauve-4)'
                                : 'transparent',
                          }}
                          onClick={() => setSelectedWorkspace(workspace)}
                          onKeyDown={e => e.key === 'Enter' && setSelectedWorkspace(workspace)}
                        >
                          <input
                            type="radio"
                            checked={selectedWorkspace?.name === workspace.name}
                            onChange={() => setSelectedWorkspace(workspace)}
                            style={{ cursor: 'pointer' }}
                          />
                          <span style={{ flex: 1 }}>{workspace.name}</span>
                          <span style={{ color: 'var(--mauve-11)', fontSize: '0.85rem' }}>
                            {workspace.type === 'folder' ? 'Folder' : 'Browser'}
                          </span>
                          {workspace.type === 'folder' && (
                            <button
                              type="button"
                              className={s.dialogButton}
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                              onClick={e => handleRemoveRecent(workspace, e)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className={s.dialogRightSlot} style={{ marginTop: '1rem' }}>
            <button type="button" className={s.dialogButton} onClick={() => onComplete(null)}>
              Cancel
            </button>
            {selectedWorkspace && (
              <button type="button" className={s.dialogButton} onClick={handleSelectRecent}>
                Open {selectedWorkspace.name}
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
