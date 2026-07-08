import { useState } from 'react'
import type { BlockLibraryRef } from './block-library'
import { DataImporterTool } from './tools/data-importer-tool'
import { PointWizardTool } from './tools/point-wizard-tool'
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
        <button type="button" className={s.toolButton} onClick={handleAddNode}>
          <i className="pi pi-plus-circle" />
          <span className={s.toolLabel}>Add Node</span>
        </button>

        <button type="button" className={s.toolButton} onClick={() => setShowPointWizard(true)}>
          <i className="pi pi-map-marker" />
          <span className={s.toolLabel}>Create Point</span>
        </button>

        <button type="button" className={s.toolButton} onClick={() => setShowDataImporter(true)}>
          <i className="pi pi-file-import" />
          <span className={s.toolLabel}>Import Data</span>
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
