import { useState } from 'react'
import { PointWizardTool } from './tools/point-wizard-tool'
import { DataImporterTool } from './tools/data-importer-tool'
import type { BlockLibraryRef } from './block-library'
import s from './tools-shelf.module.css'

interface ToolsShelfProps {
  reactFlowRef: React.RefObject<HTMLDivElement>
  blockLibraryRef: React.RefObject<BlockLibraryRef>
}

export function ToolsShelf({ reactFlowRef, blockLibraryRef }: ToolsShelfProps) {
  const [showPointWizard, setShowPointWizard] = useState(false)
  const [showDataImporter, setShowDataImporter] = useState(false)

  const handleAddNode = () => {
    // Get center of viewport
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return
    const centerX = pane.left + pane.width / 2
    const centerY = pane.top + pane.height / 2
    blockLibraryRef.current?.openModal(centerX, centerY)
  }

  return (
    <>
      <div className={s.toolsShelf}>
        <button
          type="button"
          className={s.toolButton}
          onClick={handleAddNode}
          title="Add Node (A)"
        >
          <i className="pi pi-plus-circle" />
        </button>

        <button
          type="button"
          className={s.toolButton}
          onClick={() => setShowPointWizard(true)}
          title="Create Point"
        >
          <i className="pi pi-map-marker" />
        </button>

        <button
          type="button"
          className={s.toolButton}
          onClick={() => setShowDataImporter(true)}
          title="Import Data"
        >
          <i className="pi pi-file-import" />
        </button>
      </div>

      <PointWizardTool
        open={showPointWizard}
        onOpenChange={setShowPointWizard}
        reactFlowRef={reactFlowRef}
      />

      <DataImporterTool
        open={showDataImporter}
        onOpenChange={setShowDataImporter}
        reactFlowRef={reactFlowRef}
      />
    </>
  )
}
