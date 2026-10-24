import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { analytics } from '../../../utils/analytics'
import { useFileSystemStore } from '../../filesystem-store'
import { type FileImportResult, useFileImport } from '../../hooks/use-file-import'
import s from './canvas-drop-import.module.css'
import { describeDetection } from './detect-coordinates'
import { extensionOf, IMPORTABLE_EXTENSIONS, isImportable } from './import-pipelines'

interface Notice {
  tone: 'error' | 'info'
  text: string
}

// Tell the user where the points came from, or why there are none, so a CSV that
// didn't map isn't a silent empty layer
function detectionNotice({ detection }: FileImportResult): Notice | null {
  if (!detection || detection.kind === 'geojson') return null
  if (detection.kind === 'none') {
    return {
      tone: 'info',
      text: `${describeDetection(detection)}. Edit the layer's position to place the rows.`,
    }
  }
  return { tone: 'info', text: describeDetection(detection) }
}

interface CanvasDropImportProps {
  // A file handed over from the quick start dialog, imported once a project is loaded
  pendingFile?: File | null
  onPendingFileHandled?: () => void
}

// Drop a data file anywhere on the graph canvas to build its pipeline, without
// opening the Import Data dialog first. The pipeline lands where the file was
// dropped. Listeners are on the window so a drop over a node still counts.
export function CanvasDropImport({ pendingFile, onPendingFileHandled }: CanvasDropImportProps) {
  const { screenToFlowPosition, getNodes } = useReactFlow()
  const [state, setState] = useState<'idle' | 'active' | 'importing'>('idle')
  const [notice, setNotice] = useState<Notice | null>(null)
  const setError = useCallback(
    (text: string | null) => setNotice(text ? { tone: 'error', text } : null),
    []
  )
  const currentProjectName = useFileSystemStore(state => state.currentProjectName)

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
        const unsupportedFile = files[0]
        const fileType = extensionOf(unsupportedFile.name) || 'unknown'
        analytics.track('file_import_failed', {
          fileType,
          attemptedFormat: 'unknown',
          reason: 'unsupported_type',
          source: 'canvas_drop',
          fileSize: unsupportedFile.size,
        })
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
          const result = await importFile(
            file,
            { x: dropPosition.x, y: dropPosition.y + index * 700 },
            'canvas_drop'
          )
          setNotice(detectionNotice(result))
        }
        const skipped = files.length - supported.length
        if (skipped > 0) {
          // Track each skipped file
          const unsupportedFiles = files.filter(file => !isImportable(file.name))
          for (const file of unsupportedFiles) {
            const fileType = extensionOf(file.name) || 'unknown'
            analytics.track('file_import_failed', {
              fileType,
              attemptedFormat: 'unknown',
              reason: 'unsupported_type',
              source: 'canvas_drop',
              fileSize: file.size,
            })
          }
          setError(`Skipped ${skipped} unsupported file${skipped > 1 ? 's' : ''}`)
        }
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
  }, [getBasePosition, importFile, setError])

  // Import the quick start file into the project that was opened for it. Placed to
  // the left of the existing renderer so its edges run left to right.
  useEffect(() => {
    if (!pendingFile || !currentProjectName) return
    onPendingFileHandled?.()
    const renderer = getNodes().find(node => node.type === 'DeckRendererOp')
    const position = renderer
      ? { x: renderer.position.x - 1000, y: renderer.position.y }
      : getBasePosition()
    setState('importing')
    importFile(pendingFile, position, 'quickstart')
      .then(result => setNotice(detectionNotice(result)))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to import file'))
      .finally(() => setState('idle'))
  }, [
    pendingFile,
    currentProjectName,
    onPendingFileHandled,
    getNodes,
    getBasePosition,
    importFile,
    setError,
  ])

  // Clear the banner on its own so it can't linger over the graph
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

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
      {notice && (
        <div
          className={notice.tone === 'info' ? `${s.error} ${s.info}` : s.error}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <i
            className={notice.tone === 'info' ? 'pi pi-map-marker' : 'pi pi-exclamation-triangle'}
          />
          <span>{notice.text}</span>
          <button type="button" className={s.errorClose} onClick={() => setNotice(null)}>
            <i className="pi pi-times" />
          </button>
        </div>
      )}
    </>
  )
}
