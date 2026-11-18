// window.__noodles: what a script driving the editor reads and calls (#883)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProjectOpen } from '../editor/project-open'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import {
  EXPORT_EVENT,
  type ExportStatus,
  exportStatus,
  installHeadlessApi,
  openProject,
  renderVideo,
  setExportStatus,
} from './headless-api'
import { setVideoExporter } from './video-export'

const SETTINGS = {
  startTime: 0,
  endTime: 1,
  startFrame: 0,
  endFrame: 30,
  fps: 30,
  width: 640,
  height: 360,
  codec: 'avc' as const,
}

afterEach(() => {
  setVideoExporter(null)
  setExportStatus({ state: 'idle', frame: 0, totalFrames: 0 })
  delete window.__noodles
})

describe('exportStatus', () => {
  it('sends a noodles:export event with each change', () => {
    const seen: ExportStatus[] = []
    const listen = (e: Event) => seen.push((e as CustomEvent<ExportStatus>).detail)
    window.addEventListener(EXPORT_EVENT, listen)
    setExportStatus({ state: 'running', frame: 3, totalFrames: 10 })
    setExportStatus({ state: 'error', frame: 3, totalFrames: 10, error: 'stalled' })
    window.removeEventListener(EXPORT_EVENT, listen)
    expect(seen.map(s => s.state)).toEqual(['running', 'error'])
    expect(exportStatus()).toEqual({ state: 'error', frame: 3, totalFrames: 10, error: 'stalled' })
  })
})

describe('installHeadlessApi', () => {
  it('offers export status always, and opening and rendering only to a page that opted in', () => {
    installHeadlessApi('')
    expect(Object.keys(window.__noodles ?? {})).toEqual(['exportStatus'])
    for (const search of ['?headless=true', '?externalControl=true']) {
      installHeadlessApi(search)
      expect(window.__noodles?.openProject, search).toBeTypeOf('function')
      expect(window.__noodles?.renderVideo, search).toBeTypeOf('function')
    }
  })
})

describe('openProject', () => {
  it('puts the project and its files in memory and waits for its route to open', async () => {
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
    const opened = openProject('cli-test', {
      project: { version: 1, nodes: [], edges: [] },
      files: { 'data.csv': btoa('a,b\n1,2\n') },
    })
    // The editor opens the route the push names
    await vi.waitFor(() => expect(push).toHaveBeenCalled())
    expect(String(push.mock.calls[0][2])).toMatch(/\/examples\/cli-test/)
    useProjectOpen.setState({ status: 'open', route: '/examples/cli-test' }, true)
    await expect(opened).resolves.toEqual({ route: '/examples/cli-test' })
    expect(memoryProjectStore.getProjectJson('cli-test')).toMatchObject({ version: 1 })
    expect(await memoryProjectStore.readAsset('cli-test', 'data.csv')).toBe('a,b\n1,2\n')
    push.mockRestore()
    useProjectOpen.setState({ status: 'idle' }, true)
  })

  it('refuses an id that is not a plain name', async () => {
    await expect(openProject('../x', { project: {} })).rejects.toThrow(/must be letters/)
  })
})

describe('renderVideo', () => {
  it('says so when no editor is mounted', async () => {
    expect(await renderVideo()).toEqual({
      status: 'error',
      error: 'The editor is not mounted: open a project first',
    })
  })

  it("returns the exporter's file as base64", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    setVideoExporter(() => ({
      status: 'started',
      settings: SETTINGS,
      result: Promise.resolve({ status: 'done', frameCount: 31, fps: 30, buffer: bytes.buffer }),
    }))
    const result = await renderVideo({ fps: 30 })
    expect(result).toMatchObject({ status: 'done', frameCount: 31, fps: 30 })
    const base64 = result.status === 'done' ? result.base64 : ''
    expect(Uint8Array.from(atob(base64), c => c.charCodeAt(0))).toEqual(bytes)
  })

  it('passes a refusal and a failure through', async () => {
    setVideoExporter(() => ({ status: 'refused', error: 'The timeline is empty' }))
    expect(await renderVideo()).toEqual({ status: 'error', error: 'The timeline is empty' })
    setVideoExporter(() => ({
      status: 'started',
      settings: SETTINGS,
      result: Promise.resolve({ status: 'error', error: new Error('Frame 3 did not finish') }),
    }))
    expect(await renderVideo()).toEqual({ status: 'error', error: 'Frame 3 did not finish' })
  })
})
