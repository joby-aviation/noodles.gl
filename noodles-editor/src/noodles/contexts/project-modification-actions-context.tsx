import { createContext, type ReactNode, useContext, useMemo } from 'react'

export type UpdateOperatorId = (
  nodeId: string,
  newBaseName: string,
  isContainer: boolean
) => void

interface ProjectModificationActions {
  updateOperatorId: UpdateOperatorId
}

const missingProvider = () => {
  throw new Error('ProjectModificationActionsProvider is required for graph mutations')
}

const ProjectModificationActionsContext = createContext<ProjectModificationActions>({
  updateOperatorId: missingProvider,
})

export function ProjectModificationActionsProvider({
  updateOperatorId,
  children,
}: {
  updateOperatorId: UpdateOperatorId
  children: ReactNode
}) {
  const value = useMemo(() => ({ updateOperatorId }), [updateOperatorId])
  return (
    <ProjectModificationActionsContext.Provider value={value}>
      {children}
    </ProjectModificationActionsContext.Provider>
  )
}

export function useProjectModificationActions() {
  return useContext(ProjectModificationActionsContext)
}
