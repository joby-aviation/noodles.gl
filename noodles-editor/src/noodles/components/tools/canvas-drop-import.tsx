import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFileImport } from '../../hooks/use-file-import'
import s from './canvas-drop-import.module.css'
import { IMPORTABLE_EXTENSIONS, isImportable } from './import-pipelines'

// Drop a data file anywhere on the graph canvas to build its pipeline, without
// opening the Import Data dialog first. The pipeline lands where the file was
// dropped. Listeners are on the window so a drop over a node still counts.
export function CanvasDropImport() {
  const { screenToFlowPosition } = useReactFlow()
  const [state, setState] = useState<'idle' | 'active' | 'importing'>('idle')
  const [error, setError] = useState<string | null>(null)

  // dragenter/dragleave fire per element as the cursor moves over children, so
  // count them rather than clearing the highlight on the first leave
  const dragDepth = useRef(0)

  const getBasePosition = useCallback(
    (event?: { clientX: number; clientY: number }) =>
      event
        ? screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [screenToFlowPosition]
  )

  const { importFile } = useFileImport({ getBasePosition })

  useEffect(() => {
    // Only react to an OS file drag, not to a node or block being dragged in the editor
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragDepth.current += 1
      setState(prev => (prev === 'importing' ? prev : 'active'))
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      // Without this the browser navigates to the file instead of dropping it
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setState(prev => (prev === 'importing' ? prev : 'idle'))
    }

    const onDrop = async (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) {
        setState('idle')
        return
      }

      const supported = files.filter(file => isImportable(file.name))
      if (supported.length === 0) {
        setState('idle')
        setError(`Can't import ${files[0].name}. Supported: ${IMPORTABLE_EXTENSIONS.join(', ')}`)
        return
      }

      setState('importing')
      setError(null)
      // Offset each file so multiple drops don't stack on top of each other
      const dropPosition = getBasePosition(event)
      try {
        for (const [index, file] of supported.entries()) {
          await importFile(
            file,
            { x: dropPosition.x, y: dropPosition.y + index * 700 },
            'canvas_drop'
          )
        }
        const skipped = files.length - supported.length
        if (skipped > 0) setError(`Skipped ${skipped} unsupported file${skipped > 1 ? 's' : ''}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import file')
      } finally {
        setState('idle')
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [getBasePosition, importFile])

  // Clear the error banner on its own so it can't linger over the graph
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(timer)
  }, [error])

  return (
    <>
      {state !== 'idle' && (
        <div className={s.overlay}>
          <div className={s.card}>
            {state === 'importing' ? (
              <>
                <i className={`pi pi-spin pi-spinner ${s.icon}`} />
                <div className={s.title}>Importing…</div>
              </>
            ) : (
              <>
                <i className={`pi pi-cloud-upload ${s.icon}`} />
                <div className={s.title}>Drop to add to the graph</div>
                <div className={s.hint}>CSV, GeoJSON, JSON, Shapefile, GeoParquet, PMTiles</div>
              </>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className={s.error}>
          <i className="pi pi-exclamation-triangle" />
          <span>{error}</span>
          <button type="button" className={s.errorClose} onClick={() => setError(null)}>
            <i className="pi pi-times" />
          </button>
        </div>
      )}
    </>
  )
}
