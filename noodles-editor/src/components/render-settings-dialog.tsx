import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import {
  DEFAULT_RENDER_SETTINGS,
  type RenderSettings,
} from '../noodles/utils/serialization'
import s from './render-settings-dialog.module.css'

interface RenderSettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
  settings: RenderSettings
  onSettingsChange: (settings: RenderSettings) => void
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

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={`${s.content} nokey`}>
          <Dialog.Title className={s.title}>Render Settings</Dialog.Title>

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
                  <label htmlFor="render-resolution-width" className={s.label}>
                    Resolution
                  </label>
                  <div className={s.resolutionInputs}>
                    <input
                      id="render-resolution-width"
                      type="number"
                      className={s.numberInput}
                      value={settings.resolution.width}
                      onChange={e =>
                        updateSetting('resolution', {
                          ...settings.resolution,
                          width: Number(e.target.value),
                        })
                      }
                    />
                    <span className={s.separator}>x</span>
                    <input
                      id="render-resolution-height"
                      type="number"
                      className={s.numberInput}
                      value={settings.resolution.height}
                      onChange={e =>
                        updateSetting('resolution', {
                          ...settings.resolution,
                          height: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

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
                min="5"
                max="60"
                onChange={e => updateSetting('bitrateMbps', Number(e.target.value))}
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

          <Dialog.Close asChild>
            <button type="button" className={s.iconButton} aria-label="Close">
              <Cross2Icon width={20} height={20} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
