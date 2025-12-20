import { useState } from 'react'
import { PointWizardTool } from './tools/point-wizard-tool'
import { DataImporterTool } from './tools/data-importer-tool'
import s from './tools-shelf.module.css'

interface ToolsShelfProps {
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function ToolsShelf({ reactFlowRef }: ToolsShelfProps) {
  const [showPointWizard, setShowPointWizard] = useState(false)
  const [showDataImporter, setShowDataImporter] = useState(false)

  return (
    <>
      <div className={s.toolsShelf}>
        <button
          type="button"
          className={s.toolButton}
          onClick={() => setShowPointWizard(true)}
          title="Create Point"
        >
          <i className="pi pi-map-marker" />
          <span>Add Point</span>
        </button>

        <button
          type="button"
          className={s.toolButton}
          onClick={() => setShowDataImporter(true)}
          title="Import Data"
        >
          <i className="pi pi-file-import" />
          <span>Import Data</span>
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
