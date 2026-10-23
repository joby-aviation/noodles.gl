import { useCallback } from 'react'
import { besideNetwork, commitBuilt } from '../../../editor/doc-builder'
import { docStore } from '../../../editor/doc-store'
import { pointDoc } from '../../../editor/tool-docs'
import { analytics } from '../../../utils/analytics'
import { GeocodingDialog } from '../geocoding-dialog'

interface PointWizardToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function PointWizardTool({ open, onOpenChange }: PointWizardToolProps) {
  const handleLocationSelected = useCallback(
    ({ longitude, latitude }: { longitude: number; latitude: number }) => {
      const { doc, network } = docStore().get()
      commitBuilt(
        docStore(),
        pointDoc({ doc, network, basePosition: besideNetwork(doc, network) }, longitude, latitude)
      )
      analytics.track('point_created', {
        source: 'tools_shelf',
      })
    },
    []
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
