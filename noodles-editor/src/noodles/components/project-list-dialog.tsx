import { Button, Dialog, Flex, RadioGroup, Text } from '@radix-ui/themes'
import { useCallback, useEffect, useState } from 'react'
import { listProjects } from '../storage/workspace-storage'
import type { Workspace } from '../storage/workspace-types'

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
      <Dialog.Content style={{ maxWidth: 500 }}>
        <Dialog.Title>{prompt || `Select Project from ${workspace.name}`}</Dialog.Title>

        <Flex direction="column" gap="4" mt="4">
          {isLoading && <Text color="gray">Loading projects...</Text>}

          {error && <Text color="red">{error}</Text>}

          {!isLoading && !error && projects.length === 0 && (
            <Text color="gray">No projects found in this workspace.</Text>
          )}

          {!isLoading && !error && projects.length > 0 && (
            <RadioGroup.Root
              value={selectedProject || ''}
              onValueChange={name => setSelectedProject(name)}
            >
              <Flex direction="column" gap="2">
                {projects.map(name => (
                  <Flex key={name} align="center" gap="2">
                    <RadioGroup.Item value={name} />
                    <Text>{name}</Text>
                  </Flex>
                ))}
              </Flex>
            </RadioGroup.Root>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          {selectedProject && <Button onClick={handleSelect}>Open {selectedProject}</Button>}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
