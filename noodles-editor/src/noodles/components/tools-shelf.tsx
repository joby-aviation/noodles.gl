import { useState } from 'react'
import type { BlockLibraryRef } from './block-library'
import { DataImporterTool } from './tools/data-importer-tool'
import { DrawGeometryTool } from './tools/draw-geometry-tool'
import type { GeoRecipe } from './tools/geo-recipes'
import { GeoToolMenu } from './tools/geo-tool-menu'
import { GeoToolWizard } from './tools/geo-tool-wizard'
import { MeasureTool } from './tools/measure-tool'
import { PointWizardTool } from './tools/point-wizard-tool'
import s from './tools-shelf.module.css'

interface ToolsShelfProps {
  reactFlowRef: React.RefObject<HTMLDivElement>
  blockLibraryRef: React.RefObject<BlockLibraryRef>
}

export function ToolsShelf({ reactFlowRef, blockLibraryRef }: ToolsShelfProps) {
  const [showPointWizard, setShowPointWizard] = useState(false)
  const [showDataImporter, setShowDataImporter] = useState(false)
  const [showMeasure, setShowMeasure] = useState(false)
  const [showDrawGeometry, setShowDrawGeometry] = useState(false)
  const [activeRecipe, setActiveRecipe] = useState<GeoRecipe | null>(null)

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

        <button type="button" className={s.toolButton} onClick={() => setShowDataImporter(true)}>
          <i className="pi pi-file-import" />
          <span className={s.toolLabel}>Import Data</span>
        </button>

        <div className={s.divider} />

        <button type="button" className={s.toolButton} onClick={() => setShowPointWizard(true)}>
          <i className="pi pi-map-marker" />
          <span className={s.toolLabel}>Create Point</span>
        </button>

        <button type="button" className={s.toolButton} onClick={() => setShowDrawGeometry(true)}>
          <i className="pi pi-pencil" />
          <span className={s.toolLabel}>Draw</span>
        </button>

        <button type="button" className={s.toolButton} onClick={() => setShowMeasure(true)}>
          <i className="pi pi-arrows-h" />
          <span className={s.toolLabel}>Measure</span>
        </button>

        <div className={s.divider} />

        <GeoToolMenu onSelectRecipe={setActiveRecipe}>
          <button type="button" className={s.toolButtonWide}>
            <i className="pi pi-sitemap" />
            <span className={s.toolLabel}>GIS Tools</span>
            <i className={`pi pi-angle-down ${s.caret}`} />
          </button>
        </GeoToolMenu>
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

      <MeasureTool open={showMeasure} onOpenChange={setShowMeasure} />

      <DrawGeometryTool
        open={showDrawGeometry}
        onOpenChange={setShowDrawGeometry}
        reactFlowRef={reactFlowRef}
      />

      <GeoToolWizard
        recipe={activeRecipe}
        onOpenChange={open => {
          if (!open) setActiveRecipe(null)
        }}
        reactFlowRef={reactFlowRef}
      />
    </>
  )
}
