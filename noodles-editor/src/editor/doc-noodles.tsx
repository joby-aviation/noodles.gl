// The editor on documents: opens a project as an `EditorDoc`, runs it on the planner engine,
// and hands the editor layout its network, properties panel and visualization. It replaces
// the operator-graph editor (`noodles/noodles.tsx`), which is deleted once nothing reads it.

import type { EditorDoc } from '@noodles.gl/planner'
import { PrimeReactProvider } from 'primereact/api'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { getPendingQuickStartAction } from '../components/quick-start-modal'
import { ErrorBoundary } from '../noodles/components/error-boundary'
import { LayerPanel } from '../noodles/components/layer-panel'
import { NodeTreeSidebar } from '../noodles/components/node-tree-sidebar'
import { SidebarTabs } from '../noodles/components/sidebar-tabs'
import { CanvasDropImport } from '../noodles/components/tools/canvas-drop-import'
import { useActiveStorageType, useFileSystemStore } from '../noodles/filesystem-store'
import newProjectJSON from '../noodles/new.json'
import { copyExampleAssetsToMemory, load, readAssetBinary } from '../noodles/storage'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import {
  DEFAULT_RENDER_SETTINGS,
  type NoodlesProjectJSON,
  type RenderSettings,
  saveProjectLocally,
} from '../noodles/utils/serialization'
import { TimelineProvider } from '../timeline/timeline-context'
import { useTimelineStore } from '../timeline/timeline-store'
import { analytics } from '../utils/analytics'
import type { Visualization } from '../visualizations'
import { bindEngine, settleEngine, useEngineState, visCommitted } from './doc-engine'
import { canPaste, copySelection, DocNetwork, pasteClipboard } from './doc-network'
import { setParam } from './doc-ops'
import { useUIStore } from './ui-store'
import '../noodles/layers.css'
import { DocProperties } from './doc-properties'
import { docStore, useEditor } from './doc-store'
import { bindTimeline, resetTimelinePanel } from './doc-timeline'
import type { CopyControlsRef, UndoRedoHandlerRef } from './edit-menu'
import { loadDoc } from './load-doc'
import { useProjectFiles } from './project-files'

const ChatPanel = lazy(() => import('../ai-chat/chat-panel').then(m => ({ default: m.ChatPanel })))

const exampleProjectUrls = import.meta.glob('../examples/**/noodles.json', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** The planner operator that is a document's output: its deck, basemap and export settings. */
const DOC_DECK = 'deck'

/** Project assets the way file nodes read them: from whichever storage is active now. */
async function readProjectAsset(name: string): Promise<Uint8Array> {
  const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
  const result = await readAssetBinary(activeStorageType, currentProjectName ?? '', name)
  if (!result.success) throw new Error(result.error.message)
  return new Uint8Array(result.data)
}

/** The deck node's export parameters as the renderer's settings. */
function renderSettingsOf(doc: EditorDoc): RenderSettings {
  const p = doc.nodes.find(n => n.op === DOC_DECK)?.params ?? {}
  const d = DEFAULT_RENDER_SETTINGS
  const pick = <T,>(key: string, fallback: T): T => (p[key] ?? fallback) as T
  return {
    display: pick('display', d.display),
    resolution: {
      width: pick('width', d.resolution.width),
      height: pick('height', d.resolution.height),
    },
    lod: pick('lod', d.lod),
    scaleMode: pick('scaleMode', d.scaleMode),
    waitForData: pick('waitForData', d.waitForData),
    codec: pick('codec', d.codec),
    bitrateMbps: pick('bitrateMbps', d.bitrateMbps),
    bitrateMode: pick('bitrateMode', d.bitrateMode),
    scaleControl: pick('scaleControl', d.scaleControl),
    framerate: pick('framerate', d.framerate),
    captureDelay: pick('captureDelay', d.captureDelay),
    rendersDirectory: pick('rendersDirectory', d.rendersDirectory),
  }
}

/** Open a document. The timeline panel follows it through `bindTimeline`. */
function openDoc(doc: EditorDoc) {
  resetTimelinePanel()
  docStore().load(doc)
}

async function openJson(json: unknown, name?: string): Promise<void> {
  const { doc, warnings } = await loadDoc(json, name)
  for (const w of warnings) console.info('[open]', w)
  openDoc(doc)
}

export function useDocNoodles(): Visualization {
  const [location, navigate] = useLocation()
  const params = useParams()
  const projectName = params.projectId ?? null
  const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'
  const storageType = useActiveStorageType()
  const { setCurrentDirectory, setActiveStorageType, setError } = useFileSystemStore()
  const doc = useEditor(s => s.doc)
  const dirty = useEditor(s => s.dirty)
  const selection = useEditor(s => s.selection)
  const { vis } = useEngineState()
  useEffect(() => visCommitted(vis), [vis])
  const [showOverlay, setShowOverlay] = useState(true)
  const showDebugInfo = useEditor(s => s.debug ?? false)
  const setShowDebugInfo = useCallback((debug: boolean) => docStore().set({ debug }), [])
  const spreadsheetVisible = useUIStore(state => state.spreadsheetVisible)
  const setSpreadsheetVisible = useUIStore(state => state.setSpreadsheetVisible)
  const reactFlowRef = useRef<HTMLDivElement>(null)
  const [showChatPanel, setShowChatPanel] = useState(false)

  // The assistant's context bundles load the first time the chat opens
  const contextLoadStarted = useRef(false)
  useEffect(() => {
    if (!showChatPanel || contextLoadStarted.current) return
    contextLoadStarted.current = true
    void import('../ai-chat/global-context-manager').then(m =>
      m.globalContextManager.startLoading().catch(error => console.warn('[assistant]', error))
    )
  }, [showChatPanel])

  // The engine runs whatever document the store holds, at the timeline's playhead.
  useEffect(() => bindEngine(docStore(), readProjectAsset), [])
  useEffect(() => bindTimeline(docStore()), [])
  const position = useTimelineStore(s => s.position)
  useEffect(() => docStore().set({ time: position }), [position])

  // The route names the project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a route change opens a project; nothing else should
  useEffect(() => {
    void (async () => {
      try {
        if (!projectName) {
          await openJson(newProjectJSON, 'Untitled')
          return
        }
        if (projectName === 'new' || routePrefix === '/examples') {
          const inMemory = memoryProjectStore.getProjectJson(projectName)
          if (inMemory) {
            setCurrentDirectory(null, projectName)
            setActiveStorageType('memory')
            await openJson(inMemory, projectName)
            return
          }
        }
        if (projectName === 'new') {
          setCurrentDirectory(null, 'new')
          setActiveStorageType('memory')
          await openJson(newProjectJSON, 'new')
          return
        }
        if (routePrefix === '/examples') {
          const url = exampleProjectUrls[`../examples/${projectName}/noodles.json`]
          if (!url) {
            files.setNotFound('example')
            return
          }
          const response = await fetch(url)
          if (!response.ok) throw new Error(`Failed to fetch example: ${response.statusText}`)
          const json = await response.json()
          await copyExampleAssetsToMemory(projectName, projectName)
          setCurrentDirectory(null, projectName)
          setActiveStorageType('memory')
          await openJson(json, projectName)
          return
        }
        const result = await load(storageType, projectName)
        if (!result.success && result.error.type === 'not-found') {
          files.setNotFound('project')
          return
        }
        if (!result.success) throw new Error(result.error.message)
        setCurrentDirectory(result.data.directoryHandle, projectName)
        setActiveStorageType(storageType)
        await openJson(result.data.projectData, projectName)
      } catch (error) {
        setError({
          type: 'unknown',
          message: 'Error opening project',
          details: error instanceof Error ? error.message : String(error),
          originalError: error,
        })
      }
    })()
  }, [projectName, routePrefix])

  const onDownload = useCallback(async () => {
    await saveProjectLocally(
      projectName ?? 'untitled',
      docStore().get().doc as unknown as NoodlesProjectJSON,
      storageType,
      new Map()
    )
  }, [projectName, storageType])

  const onNewProject = useCallback(async () => {
    memoryProjectStore.setProjectJson('new', newProjectJSON as unknown as NoodlesProjectJSON)
    navigate('/projects/new')
  }, [navigate])

  const onImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        await openJson(JSON.parse(await file.text()), file.name.replace(/\.json$/, ''))
      } catch (error) {
        setError({
          type: 'unknown',
          message: 'Error importing project',
          details: error instanceof Error ? error.message : String(error),
          originalError: error,
        })
      }
    }
    input.click()
  }, [setError])

  const files = useProjectFiles({
    projectName,
    storageType,
    navigate,
    open: openJson,
    onNewProject,
    onImport,
  })

  // An action the quick start chose before the project opened: a question for the assistant,
  // or a file to draw (coordinates found) or to ask the assistant about
  const loadId = useEditor(s => s.loadId)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [chatInitialMessage, setChatInitialMessage] = useState<string>()
  useEffect(() => {
    if (loadId === 0) return
    const action = getPendingQuickStartAction()
    if (!action) return
    if (action.type === 'llm' && action.question) {
      setChatInitialMessage(action.question)
      setShowChatPanel(true)
      analytics.track('quick_start_llm_action_handled')
    } else if (action.type === 'file' && action.file) {
      if (action.mode === 'map') {
        setPendingImportFile(action.file)
        analytics.track('quick_start_file_action_handled', { mode: 'map' })
        return
      }
      setChatInitialMessage(
        `I just uploaded a file called "${action.file.name}". Please help me create a visualization from this data. First, I'll need to import it using the Data Importer (click the upload icon in the toolbar). Can you guide me through the process?`
      )
      setShowChatPanel(true)
      analytics.track('quick_start_file_action_handled', { mode: 'chat' })
    }
  }, [loadId])

  const undoRedoRef = useRef<UndoRedoHandlerRef>({
    undo: () => docStore().undo(),
    redo: () => docStore().redo(),
    canUndo: () => docStore().canUndo(),
    canRedo: () => docStore().canRedo(),
    getState: () => ({ canUndo: docStore().canUndo(), canRedo: docStore().canRedo() }),
  })
  const copyControlsRef = useRef<CopyControlsRef>({
    copy: () => void copySelection(),
    paste: () => void pasteClipboard(),
    canCopy: () => docStore().get().selection.length > 0,
    canPaste,
  })

  const renderSettings = useMemo(() => renderSettingsOf(doc), [doc])
  const setRenderSettings = useCallback((settings: RenderSettings) => {
    docStore().edit(d => {
      const deck = d.nodes.find(n => n.op === DOC_DECK)
      if (!deck) return
      const { resolution, ...rest } = settings
      for (const [k, v] of Object.entries({ ...rest, ...resolution })) {
        setParam(d, deck.id, k, v as never)
      }
    }, 'render-settings')
  }, [])

  const flowGraph = (
    <div ref={reactFlowRef} style={{ position: 'absolute', inset: 0 }}>
      <PrimeReactProvider>
        <TimelineProvider>
          <DocNetwork>
            <CanvasDropImport
              pendingFile={pendingImportFile}
              onPendingFileHandled={() => setPendingImportFile(null)}
            />
          </DocNetwork>
          {files.dialogs}
        </TimelineProvider>
      </PrimeReactProvider>
    </div>
  )

  const chatPanel = (
    <Suspense fallback={null}>
      <ChatPanel
        onClose={() => setShowChatPanel(false)}
        isVisible={showChatPanel}
        initialMessage={chatInitialMessage}
      />
    </Suspense>
  )

  return {
    flowGraph,
    chatPanel,
    showChatPanel,
    onChangeShowChatPanel: setShowChatPanel,
    selectedNodeIds: selection,
    propertiesPanel: <DocProperties />,
    nodeSidebar: (
      <ErrorBoundary title="Sidebar Error">
        <SidebarTabs
          tabs={[
            { id: 'nodes', label: 'Nodes', icon: 'pi-sitemap', content: <NodeTreeSidebar /> },
            { id: 'layers', label: 'Layers', icon: 'pi-clone', content: <LayerPanel /> },
          ]}
        />
      </ErrorBoundary>
    ),
    showOverlay,
    onChangeShowOverlay: setShowOverlay,
    showDebugInfo,
    onChangeShowDebugInfo: setShowDebugInfo,
    spreadsheetVisible,
    onChangeSpreadsheetVisible: setSpreadsheetVisible,
    projectName: projectName ?? doc.name,
    onSaveProject: files.onSaveProject,
    onSaveAs: files.onSaveAs,
    onRename: files.onRename,
    onDownload,
    onNewProject,
    onImport,
    undoRedoRef,
    copyControlsRef,
    reactFlowRef: reactFlowRef as React.RefObject<HTMLDivElement>,
    hasUnsavedChanges: dirty,
    renderSettings,
    setRenderSettings,
    settle: settleEngine,
    deckProps: (vis?.deckProps ?? { layers: [] }) as Visualization['deckProps'],
    mapProps: vis?.mapProps as Visualization['mapProps'],
    maplibreLayers: vis?.maplibreLayers as Visualization['maplibreLayers'],
  }
}
