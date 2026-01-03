import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { analytics } from '../../../utils/analytics'
import { useNestingStore } from '../../store'
import type { NodeJSON } from '../../transform-graph'
import type { OpType } from '../../operators'
import { nodeId } from '../../utils/id-utils'
import { GeocodingDialog } from '../geocoding-dialog'

interface PointWizardToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function PointWizardTool({ open, onOpenChange, reactFlowRef }: PointWizardToolProps) {
  const { addNodes, screenToFlowPosition } = useReactFlow()
  const currentContainerId = useNestingStore((state) => state.currentContainerId)

  const handleLocationSelected = useCallback(
    ({ longitude, latitude }: { longitude: number; latitude: number }) => {
      // Position node at center of viewport
      const pane = reactFlowRef.current?.getBoundingClientRect()
      if (!pane) return

      const position = screenToFlowPosition({
        x: pane.left + pane.width / 2,
        y: pane.top + pane.height / 2,
      })

      // Create PointOp node
      const pointId = nodeId('point', currentContainerId || '/')
      const node: NodeJSON<OpType> = {
        id: pointId,
        type: 'PointOp',
        data: {
          inputs: {
            coordinates: [longitude, latitude],
          },
        },
        position,
      }

      addNodes([node])

      analytics.track('point_created', {
        source: 'tools_shelf',
      })
    },
    [addNodes, screenToFlowPosition, reactFlowRef, currentContainerId]
  )

  return (
    <GeocodingDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="create-node"
      onLocationSelected={handleLocationSelected}
    />
  )
}
