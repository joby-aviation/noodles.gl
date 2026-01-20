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

function getResolutionPresetValue(width: number, height: number): string {
  const preset = RESOLUTION_PRESETS.find(p => p.width === width && p.height === height)
  return preset ? `${preset.width}x${preset.height}` : 'custom'
}

interface RenderSettingsPanelProps {
  op: OutOp
}

export function RenderSettingsPanel({ op }: RenderSettingsPanelProps) {
  // Subscribe to active OutOp state
  const activeOutOpId = useActiveOutOpStore(state => state.activeOutOpId)
  const setActiveOutOpId = useActiveOutOpStore(state => state.setActiveOutOpId)
  const isActive = activeOutOpId === op.id

  // Get export actions from context (provided by TimelineEditor)
  const { startRender, takeScreenshot, isRendering } = useExportActions()

  // Subscribe to field changes
  const [display, setDisplay] = useState(op.inputs.display.value)
  const [width, setWidth] = useState(op.inputs.width.value)
  const [height, setHeight] = useState(op.inputs.height.value)
  const [lod, setLod] = useState(op.inputs.lod.value)
  const [scaleControl, setScaleControl] = useState(op.inputs.scaleControl.value)
  const [codec, setCodec] = useState(op.inputs.codec.value)
  const [framerate, setFramerate] = useState(op.inputs.framerate.value)
  const [bitrateMbps, setBitrateMbps] = useState(op.inputs.bitrateMbps.value)
  const [bitrateMode, setBitrateMode] = useState(op.inputs.bitrateMode.value)
  const [waitForData, setWaitForData] = useState(op.inputs.waitForData.value)
  const [captureDelay, setCaptureDelay] = useState(op.inputs.captureDelay.value)

  useEffect(() => {
    const subscriptions = [
      op.inputs.display.subscribe(v => setDisplay(v)),
      op.inputs.width.subscribe(v => setWidth(v)),
      op.inputs.height.subscribe(v => setHeight(v)),
      op.inputs.lod.subscribe(v => setLod(v)),
      op.inputs.scaleControl.subscribe(v => setScaleControl(v)),
      op.inputs.codec.subscribe(v => setCodec(v)),
      op.inputs.framerate.subscribe(v => setFramerate(v)),
      op.inputs.bitrateMbps.subscribe(v => setBitrateMbps(v)),
      op.inputs.bitrateMode.subscribe(v => setBitrateMode(v)),
      op.inputs.waitForData.subscribe(v => setWaitForData(v)),
      op.inputs.captureDelay.subscribe(v => setCaptureDelay(v)),
    ]
    return () => {
      for (const sub of subscriptions) sub.unsubscribe()
    }
  }, [op])

  const handleResolutionPresetChange = useCallback(
    (value: string) => {
      if (value === 'custom') return
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
    op.inputs.scaleControl.setValue(DEFAULT_RENDER_SETTINGS.scaleControl)
    op.inputs.codec.setValue(DEFAULT_RENDER_SETTINGS.codec)
    op.inputs.framerate.setValue(DEFAULT_RENDER_SETTINGS.framerate)
    op.inputs.bitrateMbps.setValue(DEFAULT_RENDER_SETTINGS.bitrateMbps)
    op.inputs.bitrateMode.setValue(DEFAULT_RENDER_SETTINGS.bitrateMode)
    op.inputs.waitForData.setValue(DEFAULT_RENDER_SETTINGS.waitForData)
    op.inputs.captureDelay.setValue(DEFAULT_RENDER_SETTINGS.captureDelay)
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
              <label htmlFor="render-resolution-preset" className={s.label}>
                Resolution
              </label>
              <select
                id="render-resolution-preset"
                className={s.select}
                value={getResolutionPresetValue(width, height)}
                onChange={e => handleResolutionPresetChange(e.target.value)}
              >
                {RESOLUTION_PRESETS.map(preset => (
                  <option
                    key={`${preset.width}x${preset.height}`}
                    value={`${preset.width}x${preset.height}`}
                  >
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </div>

            {getResolutionPresetValue(width, height) === 'custom' && (
              <div className={s.settingRow}>
                <label htmlFor="render-resolution-width" className={s.label}>
                  Size
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
                </div>
              </div>
            )}

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
