import { useCallback, useEffect, useState } from 'react'
import { useExportActions } from '../contexts/export-actions-context'
import type { OutOp } from '../operators'
import { useActiveOutOpStore } from '../store'
import { DEFAULT_RENDER_SETTINGS } from '../utils/serialization'
import s from './render-settings-panel.module.css'

const RESOLUTION_PRESETS = [
  { label: '1080p 16:9', width: 1920, height: 1080 },
  { label: '1080p 9:16', width: 1080, height: 1920 },
  { label: '1080p 1:1', width: 1080, height: 1080 },
  { label: '1080p 4:5', width: 1080, height: 1350 },
  { label: '720p 16:9', width: 1280, height: 720 },
  { label: '4K 16:9', width: 3840, height: 2160 },
] as const

interface RenderSettingsPanelProps {
  op: OutOp
}

export function RenderSettingsPanel({ op }: RenderSettingsPanelProps) {
  // Subscribe to active OutOp state
  const activeOutOpId = useActiveOutOpStore(state => state.activeOutOpId)
  const setActiveOutOpId = useActiveOutOpStore(state => state.setActiveOutOpId)
  const isActive = activeOutOpId === op.id

  // Get export actions from context (provided by TimelineEditor)
  const { startRender, takeScreenshot, exportSequence, selectRendersDirectory, isRendering } =
    useExportActions()

  // Subscribe to field changes
  const [display, setDisplay] = useState(op.inputs.display.value)
  const [width, setWidth] = useState(op.inputs.width.value)
  const [height, setHeight] = useState(op.inputs.height.value)
  const [lod, setLod] = useState(op.inputs.lod.value)
  const [scaleMode, setScaleMode] = useState(op.inputs.scaleMode.value)
  const [scaleControl, setScaleControl] = useState(op.inputs.scaleControl.value)
  const [codec, setCodec] = useState(op.inputs.codec.value)
  const [framerate, setFramerate] = useState(op.inputs.framerate.value)
  const [bitrateMbps, setBitrateMbps] = useState(op.inputs.bitrateMbps.value)
  const [bitrateMode, setBitrateMode] = useState(op.inputs.bitrateMode.value)
  const [waitForData, setWaitForData] = useState(op.inputs.waitForData.value)
  const [captureDelay, setCaptureDelay] = useState(op.inputs.captureDelay.value)
  const [fileName, setFileName] = useState(op.inputs.fileName.value)
  const [fileNameExpression, setFileNameExpression] = useState(op.inputs.fileName.expression)
  const [imageFormat, setImageFormat] = useState(op.inputs.imageFormat.value)
  const [rendersDirectory, setRendersDirectory] = useState(op.inputs.rendersDirectory.value)

  useEffect(() => {
    const subscriptions = [
      op.inputs.display.subscribe(v => setDisplay(v)),
      op.inputs.width.subscribe(v => setWidth(v)),
      op.inputs.height.subscribe(v => setHeight(v)),
      op.inputs.lod.subscribe(v => setLod(v)),
      op.inputs.scaleMode.subscribe(v => setScaleMode(v)),
      op.inputs.scaleControl.subscribe(v => setScaleControl(v)),
      op.inputs.codec.subscribe(v => setCodec(v)),
      op.inputs.framerate.subscribe(v => setFramerate(v)),
      op.inputs.bitrateMbps.subscribe(v => setBitrateMbps(v)),
      op.inputs.bitrateMode.subscribe(v => setBitrateMode(v)),
      op.inputs.waitForData.subscribe(v => setWaitForData(v)),
      op.inputs.captureDelay.subscribe(v => setCaptureDelay(v)),
      op.inputs.fileName.subscribe(v => setFileName(v)),
      op.inputs.fileName.expression$.subscribe(v => setFileNameExpression(v)),
      op.inputs.imageFormat.subscribe(v => setImageFormat(v)),
      op.inputs.rendersDirectory.subscribe(v => setRendersDirectory(v)),
    ]
    return () => {
      for (const sub of subscriptions) sub.unsubscribe()
    }
  }, [op])

  const handleResolutionPresetChange = useCallback(
    (value: string) => {
      const [w, h] = value.split('x').map(Number)
      op.inputs.width.setValue(w)
      op.inputs.height.setValue(h)
    },
    [op]
  )

  const handleResetToDefaults = useCallback(() => {
    op.inputs.display.setValue(DEFAULT_RENDER_SETTINGS.display)
    op.inputs.width.setValue(DEFAULT_RENDER_SETTINGS.resolution.width)
    op.inputs.height.setValue(DEFAULT_RENDER_SETTINGS.resolution.height)
    op.inputs.lod.setValue(DEFAULT_RENDER_SETTINGS.lod)
    op.inputs.scaleMode.setValue(DEFAULT_RENDER_SETTINGS.scaleMode)
    op.inputs.scaleControl.setValue(DEFAULT_RENDER_SETTINGS.scaleControl)
    op.inputs.codec.setValue(DEFAULT_RENDER_SETTINGS.codec)
    op.inputs.framerate.setValue(DEFAULT_RENDER_SETTINGS.framerate)
    op.inputs.bitrateMbps.setValue(DEFAULT_RENDER_SETTINGS.bitrateMbps)
    op.inputs.bitrateMode.setValue(DEFAULT_RENDER_SETTINGS.bitrateMode)
    op.inputs.waitForData.setValue(DEFAULT_RENDER_SETTINGS.waitForData)
    op.inputs.captureDelay.setValue(DEFAULT_RENDER_SETTINGS.captureDelay)
    op.inputs.fileName.clearExpression()
    op.inputs.fileName.setValue(DEFAULT_RENDER_SETTINGS.fileName)
    op.inputs.imageFormat.setValue(DEFAULT_RENDER_SETTINGS.imageFormat)
    op.inputs.rendersDirectory.setValue(DEFAULT_RENDER_SETTINGS.rendersDirectory)
  }, [op])

  return (
    <div className={s.panel}>
      {/* Active Output Indicator */}
      {isActive ? (
        <div className={s.activeIndicator}>
          <i className="pi pi-check-circle" />
          Active Output
        </div>
      ) : (
        <button type="button" className={s.setActiveButton} onClick={() => setActiveOutOpId(op.id)}>
          Set as Active Output
        </button>
      )}

      {/* Display Section */}
      <div className={s.section}>
        <h3 className={s.sectionTitle}>Display</h3>

        <div className={s.settingRow}>
          <label htmlFor="render-display-mode" className={s.label}>
            Mode
          </label>
          <select
            id="render-display-mode"
            className={s.select}
            value={display}
            onChange={e => op.inputs.display.setValue(e.target.value as 'fixed' | 'responsive')}
          >
            <option value="fixed">Fixed</option>
            <option value="responsive">Responsive</option>
          </select>
        </div>

        {display === 'fixed' && (
          <>
            <div className={s.settingRow}>
              <label htmlFor="render-resolution-width" className={s.label}>
                Resolution
              </label>
              <div className={s.resolutionInputs}>
                <input
                  id="render-resolution-width"
                  type="number"
                  className={s.numberInput}
                  value={width}
                  min="1"
                  max="7680"
                  onChange={e => op.inputs.width.setValue(Number(e.target.value))}
                />
                <span className={s.separator}>×</span>
                <input
                  id="render-resolution-height"
                  type="number"
                  className={s.numberInput}
                  value={height}
                  min="1"
                  max="4320"
                  onChange={e => op.inputs.height.setValue(Number(e.target.value))}
                />
                <select
                  id="render-resolution-preset"
                  className={s.presetSelect}
                  value=""
                  onChange={e => handleResolutionPresetChange(e.target.value)}
                >
                  <option value="" disabled hidden />
                  {RESOLUTION_PRESETS.map(preset => (
                    <option
                      key={`${preset.width}x${preset.height}`}
                      value={`${preset.width}x${preset.height}`}
                    >
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={s.settingRow}>
              <label htmlFor="render-scale-mode" className={s.label}>
                Preview
              </label>
              <select
                id="render-scale-mode"
                className={s.select}
                value={scaleMode}
                onChange={e => op.inputs.scaleMode.setValue(e.target.value as 'fit' | 'manual')}
              >
                <option value="fit">Fit to panel</option>
                <option value="manual">Manual scale</option>
              </select>
            </div>

            {scaleMode === 'manual' && (
              <div className={s.settingRow}>
                <label htmlFor="render-scale-control" className={s.label}>
                  Scale
                </label>
                <input
                  id="render-scale-control"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={scaleControl}
                  onChange={e => op.inputs.scaleControl.setValue(Number(e.target.value))}
                  className={s.slider}
                />
                <span className={s.value}>{Math.round(scaleControl * 100)}%</span>
              </div>
            )}
          </>
        )}

        <div className={s.settingRow}>
          <label htmlFor="render-lod" className={s.label}>
            LOD
          </label>
          <input
            id="render-lod"
            type="range"
            min="0.1"
            max="4"
            step="0.1"
            value={lod}
            onChange={e => op.inputs.lod.setValue(Number(e.target.value))}
            className={s.slider}
          />
          <span className={s.value}>{lod.toFixed(1)}×</span>
        </div>
      </div>

      {/* Video Encoding Section */}
      <div className={s.section}>
        <h3 className={s.sectionTitle}>Video</h3>

        <div className={s.settingRow}>
          <label htmlFor="render-codec" className={s.label}>
            Codec
          </label>
          <select
            id="render-codec"
            className={s.select}
            value={codec}
            onChange={e => op.inputs.codec.setValue(e.target.value)}
          >
            <option value="avc">H.264</option>
            <option value="hevc">H.265</option>
            <option value="vp9">VP9</option>
            <option value="av1">AV1</option>
          </select>
        </div>

        <div className={s.settingRow}>
          <label htmlFor="render-framerate" className={s.label}>
            Framerate
          </label>
          <input
            id="render-framerate"
            type="number"
            className={s.numberInput}
            value={framerate}
            min="1"
            max="120"
            onChange={e => op.inputs.framerate.setValue(Number(e.target.value))}
          />
          <span className={s.unit}>fps</span>
        </div>

        <div className={s.settingRow}>
          <label htmlFor="render-bitrate" className={s.label}>
            Bitrate
          </label>
          <input
            id="render-bitrate"
            type="number"
            className={s.numberInput}
            value={bitrateMbps}
            min="1"
            max="100"
            onChange={e => op.inputs.bitrateMbps.setValue(Number(e.target.value))}
          />
          <span className={s.unit}>Mbps</span>
        </div>

        <div className={s.settingRow}>
          <label htmlFor="render-bitrate-mode" className={s.label}>
            Mode
          </label>
          <select
            id="render-bitrate-mode"
            className={s.select}
            value={bitrateMode}
            onChange={e =>
              op.inputs.bitrateMode.setValue(e.target.value as 'constant' | 'variable')
            }
          >
            <option value="constant">Constant</option>
            <option value="variable">Variable</option>
          </select>
        </div>
      </div>

      {/* Output Section */}
      <div className={s.section}>
        <h3 className={s.sectionTitle}>Output</h3>

        <div className={s.settingRow}>
          <label htmlFor="render-file-name" className={s.label}>
            File Name
          </label>
          <input
            id="render-file-name"
            type="text"
            className={s.textInput}
            value={fileName}
            placeholder="Project name"
            disabled={fileNameExpression !== null}
            title={
              fileNameExpression === null
                ? 'Base name; Noodles adds -v1, -v2, and the file extension'
                : `Driven by expression: ${fileNameExpression}`
            }
            onChange={e => op.inputs.fileName.setValue(e.target.value)}
          />
          {fileNameExpression !== null && (
            <span className={s.expressionBadge} title={fileNameExpression}>
              fx
            </span>
          )}
        </div>

        <div className={s.settingRow}>
          <label htmlFor="render-image-format" className={s.label}>
            Photo Format
          </label>
          <select
            id="render-image-format"
            className={s.select}
            value={imageFormat}
            onChange={e => op.inputs.imageFormat.setValue(e.target.value as 'png' | 'jpeg')}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
        </div>

        <div className={s.settingRow}>
          <label htmlFor="render-renders-directory" className={s.label}>
            Output Dir
          </label>
          <button
            id="render-renders-directory"
            type="button"
            className={s.directoryButton}
            onClick={() => selectRendersDirectory?.()}
          >
            <i className="pi pi-folder" />
            {rendersDirectory || 'renders'}
          </button>
        </div>
      </div>

      {/* Advanced Section */}
      <div className={s.section}>
        <h3 className={s.sectionTitle}>Advanced</h3>

        <div className={s.settingRow}>
          <label className={s.checkboxLabel}>
            <input
              type="checkbox"
              checked={waitForData}
              onChange={e => op.inputs.waitForData.setValue(e.target.checked)}
              className={s.checkbox}
            />
            Wait for data
          </label>
        </div>

        <div className={s.settingRow}>
          <label htmlFor="render-capture-delay" className={s.label}>
            Delay
          </label>
          <input
            id="render-capture-delay"
            type="number"
            className={s.numberInput}
            value={captureDelay}
            min="0"
            max="10000"
            step="50"
            onChange={e => op.inputs.captureDelay.setValue(Number(e.target.value))}
          />
          <span className={s.unit}>ms</span>
        </div>
      </div>

      <button type="button" className={s.resetButton} onClick={handleResetToDefaults}>
        Reset to Defaults
      </button>

      {/* Export Section */}
      <div className={s.exportSection}>
        <button
          type="button"
          className={s.exportButton}
          onClick={() => {
            // Ensure this OutOp is active before exporting
            setActiveOutOpId(op.id)
            takeScreenshot?.()
          }}
          disabled={!takeScreenshot}
        >
          <i className="pi pi-image" />
          Export Photo
        </button>
        <button
          type="button"
          className={s.exportButton}
          onClick={() => {
            // Ensure this OutOp is active before exporting
            setActiveOutOpId(op.id)
            exportSequence?.()
          }}
          disabled={!exportSequence || isRendering}
        >
          <i className="pi pi-images" />
          {isRendering ? 'Exporting...' : 'Export Sequence'}
        </button>
        <button
          type="button"
          className={s.exportButton}
          onClick={() => {
            // Ensure this OutOp is active before exporting
            setActiveOutOpId(op.id)
            startRender?.()
          }}
          disabled={!startRender || isRendering}
        >
          <i className="pi pi-video" />
          {isRendering ? 'Rendering...' : 'Export Video'}
        </button>
      </div>
    </div>
  )
}
