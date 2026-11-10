// The editor on documents: opens a project as an `EditorDoc`, runs it on the planner engine,
// and hands the editor layout its network, properties panel and visualization. It replaces
// the operator-graph editor (`noodles/noodles.tsx`), which is deleted once nothing reads it.

import { OPERATOR_INDEX } from '@noodles.gl/planner'
import { PrimeReactProvider } from 'primereact/api'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { KeyPrompts } from '../components/key-prompts'
import { getPendingQuickStartAction } from '../components/quick-start-modal'
import { CreateFromSQLDialog } from '../noodles/components/create-from-sql-dialog'
import { ErrorBoundary } from '../noodles/components/error-boundary'
import { LayerStack } from '../noodles/components/layer-stack'
import { NodeTreeSidebar } from '../noodles/components/node-tree-sidebar'
import { SidebarTabs } from '../noodles/components/sidebar-tabs'
import { CanvasDropImport } from '../noodles/components/tools/canvas-drop-import'
import { useActiveStorageType, useFileSystemStore } from '../noodles/filesystem-store'
import newProjectJSON from '../noodles/new.json'
import { readAssetBinary } from '../noodles/storage'
import { createProjectFromSQL, takeCreateFromSQLRequest } from '../noodles/utils/create-from-sql'
import { shouldAutosave, supportsVersioning, useGitSettings } from '../noodles/utils/git-settings'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import {
  type NoodlesProjectJSON,
  type RenderSettings,
  saveProjectLocally,
} from '../noodles/utils/serialization'
import { TimelineProvider } from '../timeline/timeline-context'
import { getTimelineStore, useTimelineStore } from '../timeline/timeline-store'
import { analytics } from '../utils/analytics'
import type { Visualization } from '../visualizations'
import { CanvasPaste } from './canvas-paste'
import { bindEngine, settleEngine, useEngineState, visCommitted } from './doc-engine'
import { canPaste, copySelection, DocNetwork, pasteClipboard } from './doc-network'
import { setParam } from './doc-ops'
import { getUIStore } from './ui-store'
import { setEditorShown, useEditorShown } from './workspace-store'
import '../noodles/layers.css'
import { agentBench, externalControl } from '../noodles/globals'
import { syncKeysAcrossTabs, useKeysStore } from '../noodles/keys-store'
import { trackChatClosed, trackChatOpened } from '../noodles/utils/editor-analytics'
import { claimStarterSelection, findStarterNodeId } from '../noodles/utils/starter-node'
import { DocProperties } from './doc-properties'
import { docStore, useEditor } from './doc-store'
import { bindTimeline } from './doc-timeline'
import type { CopyControlsRef, UndoRedoHandlerRef } from './edit-menu'
import { historyShortcut } from './edit-menu'
import { useProjectFiles } from './project-files'
import { closeProject, openFile, openRoute, routePath } from './project-open'
import { DOC_DECK, renderSettingsOf } from './render-settings'

const ChatPanel = lazy(() => import('../ai-chat/chat-panel').then(m => ({ default: m.ChatPanel })))
const GitHistoryPanel = lazy(() =>
  import('../noodles/components/git-history-panel').then(m => ({ default: m.GitHistoryPanel }))
)

/** Project assets the way file nodes read them: from whichever storage is active now. */
async function readProjectAsset(name: string): Promise<Uint8Array> {
  const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
  const result = await readAssetBinary(activeStorageType, currentProjectName ?? '', name)
  if (!result.success) throw new Error(result.error.message)
  return new Uint8Array(result.data)
}

// A layer: a planner layer, or a host operator that draws one
const isLayerOp = (op: string) => {
  const def = OPERATOR_INDEX.get(op)
  return (
    def?.category === 'layer' ||
    (def?.category === 'host' && def.outputs.some(o => o.type === 'layer'))
  )
}

// Examples open with one layer selected, so the parameter pane starts with controls
function selectStarterNode(exampleId: string) {
  const agentControlled = externalControl || agentBench
  if (!claimStarterSelection({ exampleId, fromBundledExample: true, agentControlled })) return
  const { doc } = docStore().get()
  const id = findStarterNodeId(doc, isLayerOp)
  const starter = id ? doc.nodes.find(n => n.id === id) : undefined
  if (!starter) return
  docStore().set({ selection: [starter.id], network: undefined })
  getUIStore().setStarterHintNodeId(starter.id)
  analytics.track('starter_node_selected', { operatorType: starter.op })
}

export function useDocNoodles(): Visualization {
  const [location, navigate] = useLocation()
  const params = useParams()
  const projectName = params.projectId ?? null
  const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'
  const storageType = useActiveStorageType()
  const { setError } = useFileSystemStore()
  const doc = useEditor(s => s.doc)
  const dirty = useEditor(s => s.dirty)
  // Keys and choices set in another tab apply here too
  useEffect(() => syncKeysAcrossTabs(), [])
  // Editing a project key in Settings changes what the project file saves
  useEffect(
    () =>
      useKeysStore.subscribe((state, prev) => {
        if (state.projectKeyEdits !== prev.projectKeyEdits) docStore().changed()
      }),
    []
  )
  const selection = useEditor(s => s.selection)
  const { vis } = useEngineState()
  useEffect(() => visCommitted(vis), [vis])
  const [showOverlay, setShowOverlay] = useState(true)
  const showDebugInfo = useEditor(s => s.debug ?? false)
  const setShowDebugInfo = useCallback((debug: boolean) => docStore().set({ debug }), [])
  const spreadsheetVisible = useEditorShown('spreadsheet')
  const reactFlowRef = useRef<HTMLDivElement>(null)
  const [showChatPanel, setShowChatPanel] = useState(false)
  const [showGitHistoryPanel, setShowGitHistoryPanel] = useState(false)
  const currentDirectory = useFileSystemStore(st => st.currentDirectory)

  // The assistant's context bundles load the first time the chat opens
  const contextLoadStarted = useRef(false)
  useEffect(() => {
    if (!showChatPanel || contextLoadStarted.current) return
    contextLoadStarted.current = true
    void import('../ai-chat/global-context-manager').then(m =>
      m.globalContextManager.startLoading().catch(error => console.warn('[assistant]', error))
    )
  }, [showChatPanel])

  // A ?createFromSQL= link shows its query and makes the project only on confirm: DuckDB can
  // fetch remote URLs, so the query never runs unseen. Read before the project-loading
  // effects, whose navigate() drops the query string.
  const [pendingCreateFromSQL, setPendingCreateFromSQL] = useState<string | null>(null)
  useEffect(() => {
    const request = takeCreateFromSQLRequest()
    if (!request) return
    if ('sql' in request) setPendingCreateFromSQL(request.sql)
    else alert(`Invalid SQL query: ${request.error}`)
  }, [])

  // The engine runs whatever document the store holds, at the timeline's playhead.
  useEffect(() => bindEngine(docStore(), readProjectAsset), [])
  useEffect(() => bindTimeline(docStore()), [])
  // Copied outside React: a subscription here would render the whole editor each frame of
  // playback to hand a number on
  useEffect(() => {
    docStore().set({ time: getTimelineStore().position })
    return useTimelineStore.subscribe(
      s => s.position,
      position => docStore().set({ time: position })
    )
  }, [])

  // The route names the project
  useEffect(() => {
    void openRoute(routePrefix, projectName, { onExampleOpened: selectStarterNode })
  }, [projectName, routePrefix])
  useEffect(() => closeProject, [])

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

  const onConfirmCreateFromSQL = useCallback(
    (sql: string) => {
      setPendingCreateFromSQL(null)
      memoryProjectStore.setProjectJson(
        'new',
        createProjectFromSQL({ sql }) as unknown as NoodlesProjectJSON
      )
      analytics.track('project_created', { method: 'createFromSQL' })
      navigate('/projects/new')
    },
    [navigate]
  )

  const onImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const json = JSON.parse(await file.text())
        await openFile(json, file.name.replace(/\.json$/, ''), routePath(routePrefix, projectName))
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
  }, [setError, routePrefix, projectName])

  const files = useProjectFiles({
    projectName,
    storageType,
    navigate,
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
      trackChatOpened('quick_start')
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
      trackChatOpened('quick_start')
      analytics.track('quick_start_file_action_handled', { mode: 'chat' })
    }
  }, [loadId])

  // Version history: every save commits a snapshot (storage.ts); autosave saves after a pause
  // when the project's settings ask for it. Reading the settings through the hook re-runs this
  // when version control or autosave is turned off, which cancels a pending save.
  const gitSettings = useGitSettings(projectName ?? null)
  const onSaveProject = files.onSaveProject
  useEffect(() => {
    const isExamplesRoute = routePrefix === '/examples'
    if (
      !shouldAutosave({
        settings: gitSettings,
        storageType,
        hasUnsavedChanges: dirty,
        isExamplesRoute,
      })
    )
      return
    const timeoutId = setTimeout(() => void onSaveProject(), gitSettings.autoCommitDelay)
    return () => clearTimeout(timeoutId)
  }, [gitSettings, storageType, dirty, routePrefix, onSaveProject])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      // mod+shift+h toggles the version history
      if (meta && e.shiftKey && key === 'h') {
        e.preventDefault()
        if (supportsVersioning(storageType)) setShowGitHistoryPanel(prev => !prev)
      }
      const step = historyShortcut(e)
      if (step) {
        e.preventDefault()
        docStore()[step]()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [storageType])

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
            <CanvasPaste />
          </DocNetwork>
          {files.dialogs}
          <CreateFromSQLDialog
            sql={pendingCreateFromSQL}
            onConfirm={onConfirmCreateFromSQL}
            onClose={() => setPendingCreateFromSQL(null)}
          />
          <KeyPrompts />
        </TimelineProvider>
      </PrimeReactProvider>
    </div>
  )

  const chatPanel = (
    <Suspense fallback={null}>
      <ChatPanel
        onClose={() => {
          trackChatClosed('panel')
          setShowChatPanel(false)
        }}
        isVisible={showChatPanel}
        initialMessage={chatInitialMessage}
      />
    </Suspense>
  )

  const gitHistoryPanel = showGitHistoryPanel && (
    <Suspense fallback={null}>
      <GitHistoryPanel
        projectDirectory={currentDirectory}
        projectName={projectName ?? doc.name}
        onClose={() => setShowGitHistoryPanel(false)}
      />
    </Suspense>
  )

  return {
    flowGraph,
    chatPanel,
    gitHistoryPanel,
    // The project whose version control settings the settings dialog edits
    versionedProjectName: supportsVersioning(storageType) ? (projectName ?? null) : null,
    showChatPanel,
    onChangeShowChatPanel: setShowChatPanel,
    selectedNodeIds: selection,
    propertiesPanel: <DocProperties />,
    nodeSidebar: (
      <ErrorBoundary title="Sidebar Error">
        <SidebarTabs
          tabs={[
            { id: 'layers', label: 'Layers', icon: 'pi-clone', content: <LayerStack /> },
            { id: 'nodes', label: 'Nodes', icon: 'pi-sitemap', content: <NodeTreeSidebar /> },
          ]}
        />
      </ErrorBoundary>
    ),
    showOverlay,
    onChangeShowOverlay: setShowOverlay,
    showDebugInfo,
    onChangeShowDebugInfo: setShowDebugInfo,
    spreadsheetVisible,
    onChangeSpreadsheetVisible: (visible: boolean) => setEditorShown('spreadsheet', visible),
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
