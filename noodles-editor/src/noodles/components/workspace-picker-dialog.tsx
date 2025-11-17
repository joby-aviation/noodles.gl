import { Button, Dialog, Flex, Heading, RadioGroup, Separator, Text } from '@radix-ui/themes'
import { useCallback, useEffect, useState } from 'react'
import type { Workspace } from '../storage/workspace-types'
import { getCachedWorkspaces, removeFromCache } from '../utils/workspace-cache'

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
      <Dialog.Content style={{ maxWidth: 500 }}>
        <Dialog.Title>{prompt || 'Select Workspace'}</Dialog.Title>

        <Flex direction="column" gap="4" mt="4">
          {/* Quick actions */}
          <Flex direction="column" gap="2">
            <Heading size="2">New Workspace</Heading>
            <Flex gap="2">
              <Button onClick={handleOpenFolder} variant="soft">
                Open Folder
              </Button>
              <Button onClick={handleBrowserStorage} variant="soft">
                Use Browser Storage
              </Button>
              <Button onClick={handleExamples} variant="soft">
                Open Examples
              </Button>
            </Flex>
          </Flex>

          {/* Recent workspaces */}
          {showRecent && recentWorkspaces.length > 0 && (
            <>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Heading size="2">Recent Workspaces</Heading>
                {isLoading ? (
                  <Text color="gray">Loading...</Text>
                ) : (
                  <RadioGroup.Root
                    value={selectedWorkspace?.name || ''}
                    onValueChange={name => {
                      const workspace = recentWorkspaces.find(w => w.name === name)
                      setSelectedWorkspace(workspace || null)
                    }}
                  >
                    <Flex direction="column" gap="2">
                      {recentWorkspaces.map(workspace => (
                        <Flex key={workspace.name} align="center" gap="2">
                          <RadioGroup.Item value={workspace.name} />
                          <Text style={{ flex: 1 }}>{workspace.name}</Text>
                          <Text color="gray" size="1">
                            {workspace.type === 'folder' ? 'Folder' : 'Browser'}
                          </Text>
                          {workspace.type === 'folder' && (
                            <Button
                              size="1"
                              variant="ghost"
                              color="red"
                              onClick={e => handleRemoveRecent(workspace, e)}
                            >
                              Remove
                            </Button>
                          )}
                        </Flex>
                      ))}
                    </Flex>
                  </RadioGroup.Root>
                )}
              </Flex>
            </>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          {selectedWorkspace && (
            <Button onClick={handleSelectRecent}>Open {selectedWorkspace.name}</Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
