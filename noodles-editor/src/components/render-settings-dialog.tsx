import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from '../noodles/utils/serialization'
import s from './render-settings-dialog.module.css'

const RESOLUTION_PRESETS = [
  { label: '1080p 16:9 - 1920×1080', width: 1920, height: 1080 },
  { label: '1080p 9:16 - 1080×1920', width: 1080, height: 1920 },
  { label: '1080p 1:1 - 1080×1080', width: 1080, height: 1080 },
  { label: '1080p 4:5 - 1080×1350', width: 1080, height: 1350 },
  { label: '1080p 3:4 - 1080×1440', width: 1080, height: 1440 },
  { label: '720p 16:9 - 1280×720', width: 1280, height: 720 },
  { label: '4K 16:9 - 3840×2160', width: 3840, height: 2160 },
  { label: '4K 1:1 - 2160×2160', width: 2160, height: 2160 },
] as const

interface RenderSettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
  settings: RenderSettings
  onSettingsChange: (settings: RenderSettings) => void
}

function getResolutionPresetValue(width: number, height: number): string {
  const preset = RESOLUTION_PRESETS.find(p => p.width === width && p.height === height)
  return preset ? `${preset.width}x${preset.height}` : 'custom'
}

export function RenderSettingsDialog({
  open,
  setOpen,
  settings,
  onSettingsChange,
}: RenderSettingsDialogProps) {
  const updateSetting = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value })
  }

  const handleResetToDefaults = () => {
    onSettingsChange({ ...DEFAULT_RENDER_SETTINGS })
  }

  const handleResolutionPresetChange = (value: string) => {
    if (value === 'custom') return
    const [width, height] = value.split('x').map(Number)
    updateSetting('resolution', { width, height })
  }

  const handleResolutionBlur = (field: 'width' | 'height', value: number) => {
    if (Number.isNaN(value) || value < 1) {
      updateSetting('resolution', {
        ...settings.resolution,
        [field]: DEFAULT_RENDER_SETTINGS.resolution[field],
      })
    }
  }

  const handleNumberBlur = <K extends keyof RenderSettings>(
    key: K,
    value: number,
    min?: number
  ) => {
    if (Number.isNaN(value) || (min !== undefined && value < min)) {
      updateSetting(key, DEFAULT_RENDER_SETTINGS[key])
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={`${s.content} nokey`}>
          <div className={s.header}>
            <Dialog.Title className={s.title}>Render Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={s.iconButton} aria-label="Close">
                <Cross2Icon width={20} height={20} />
              </button>
            </Dialog.Close>
          </div>

          <div className={s.body}>
            {/* Display Section */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Display</h3>

              <div className={s.settingRow}>
                <label htmlFor="render-display-mode" className={s.label}>
                  Display Mode
                </label>
                <select
                  id="render-display-mode"
                  className={s.select}
                  value={settings.display}
                  onChange={e => updateSetting('display', e.target.value as 'fixed' | 'responsive')}
                >
                  <option value="fixed">Fixed</option>
                  <option value="responsive">Responsive</option>
                </select>
              </div>

              {settings.display === 'fixed' && (
                <>
                  <div className={s.settingRow}>
                    <label htmlFor="render-resolution-preset" className={s.label}>
                      Resolution
                    </label>
                    <select
                      id="render-resolution-preset"
                      className={s.select}
                      value={getResolutionPresetValue(
                        settings.resolution.width,
                        settings.resolution.height
                      )}
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

                  {getResolutionPresetValue(
                    settings.resolution.width,
                    settings.resolution.height
                  ) === 'custom' && (
                    <div className={s.settingRow}>
                      <label htmlFor="render-resolution-width" className={s.label}>
                        Custom Size
                      </label>
                      <div className={s.resolutionInputs}>
                        <input
                          id="render-resolution-width"
                          type="number"
                          className={s.numberInput}
                          value={settings.resolution.width}
                          min="1"
                          max="7680"
                          onChange={e =>
                            updateSetting('resolution', {
                              ...settings.resolution,
                              width: Number(e.target.value),
                            })
                          }
                          onBlur={e => handleResolutionBlur('width', Number(e.target.value))}
                        />
                        <span className={s.separator}>x</span>
                        <input
                          id="render-resolution-height"
                          type="number"
                          className={s.numberInput}
                          value={settings.resolution.height}
                          min="1"
                          max="4320"
                          onChange={e =>
                            updateSetting('resolution', {
                              ...settings.resolution,
                              height: Number(e.target.value),
                            })
                          }
                          onBlur={e => handleResolutionBlur('height', Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}

                  <div className={s.settingRow}>
                    <label htmlFor="render-scale-control" className={s.label}>
                      Scale Control
                    </label>
                    <input
                      id="render-scale-control"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={settings.scaleControl}
                      onChange={e => updateSetting('scaleControl', Number(e.target.value))}
                      className={s.slider}
                    />
                    <span className={s.value}>{Math.round(settings.scaleControl * 100)}%</span>
                  </div>
                </>
              )}

              <div className={s.settingRow}>
                <label htmlFor="render-lod" className={s.label}>
                  Level of Detail
                </label>
                <input
                  id="render-lod"
                  type="range"
                  min="1"
                  max="2"
                  step="0.1"
                  value={settings.lod}
                  onChange={e => updateSetting('lod', Number(e.target.value))}
                  className={s.slider}
                />
                <span className={s.value}>{settings.lod.toFixed(1)}x</span>
              </div>
            </div>

            {/* Video Encoding Section */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Video Encoding</h3>

              <div className={s.settingRow}>
                <label htmlFor="render-codec" className={s.label}>
                  Codec
                </label>
                <select
                  id="render-codec"
                  className={s.select}
                  value={settings.codec}
                  onChange={e => updateSetting('codec', e.target.value as RenderSettings['codec'])}
                >
                  <option value="avc">H.264 (AVC)</option>
                  <option value="hevc">H.265 (HEVC)</option>
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
                  value={settings.framerate}
                  min="1"
                  max="120"
                  onChange={e => updateSetting('framerate', Number(e.target.value))}
                  onBlur={e => handleNumberBlur('framerate', Number(e.target.value), 1)}
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
                  value={settings.bitrateMbps}
                  min="1"
                  max="60"
                  onChange={e => updateSetting('bitrateMbps', Number(e.target.value))}
                  onBlur={e => handleNumberBlur('bitrateMbps', Number(e.target.value), 1)}
                />
                <span className={s.unit}>Mbps</span>
              </div>

              <div className={s.settingRow}>
                <label htmlFor="render-bitrate-mode" className={s.label}>
                  Bitrate Mode
                </label>
                <select
                  id="render-bitrate-mode"
                  className={s.select}
                  value={settings.bitrateMode}
                  onChange={e =>
                    updateSetting('bitrateMode', e.target.value as 'constant' | 'variable')
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
                    checked={settings.waitForData}
                    onChange={e => updateSetting('waitForData', e.target.checked)}
                    className={s.checkbox}
                  />
                  Wait for data to load
                </label>
              </div>

              <div className={s.settingRow}>
                <label htmlFor="render-capture-delay" className={s.label}>
                  Capture Delay
                </label>
                <input
                  id="render-capture-delay"
                  type="number"
                  className={s.numberInput}
                  value={settings.captureDelay}
                  min="0"
                  max="2000"
                  step="50"
                  onChange={e => updateSetting('captureDelay', Number(e.target.value))}
                  onBlur={e => handleNumberBlur('captureDelay', Number(e.target.value), 0)}
                />
                <span className={s.unit}>ms</span>
              </div>
            </div>

            <div className={s.footer}>
              <button type="button" className={s.resetButton} onClick={handleResetToDefaults}>
                Reset to Defaults
              </button>
              <Dialog.Close asChild>
                <button type="button" className={s.closeButton}>
                  Done
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
