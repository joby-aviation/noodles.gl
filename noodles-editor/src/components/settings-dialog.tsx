import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { analytics } from '../utils/analytics'
import s from './settings-dialog.module.css'

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
  showOverlay?: boolean
  setShowOverlay?: (show: boolean) => void
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
  setLayoutMode?: (mode: 'split' | 'noodles-on-top' | 'output-on-top') => void
}

export function SettingsDialog({
  open,
  setOpen,
  showOverlay,
  setShowOverlay,
  layoutMode,
  setLayoutMode,
}: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)

  useEffect(() => {
    const consent = analytics.getConsent()
    setAnalyticsEnabled(consent?.enabled ?? false)
  }, [])

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled)
    analytics.setConsent(enabled)

    if (enabled) {
      analytics.track('analytics_enabled_in_settings')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <Dialog.Title className={s.title}>Settings</Dialog.Title>

          {/* Editor Settings Section */}
          {(setShowOverlay || setLayoutMode) && (
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Editor</h3>

              {setShowOverlay && showOverlay !== undefined && (
                <div className={s.settingItem}>
                  <label className={s.settingLabel}>
                    <input
                      type="checkbox"
                      checked={showOverlay}
                      onChange={e => setShowOverlay(e.target.checked)}
                      className={s.checkbox}
                    />
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Show node graph overlay</div>
                      <div className={s.settingDescription}>
                        Display the node graph editor overlay on the visualization output.
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {setLayoutMode && layoutMode && (
                <div className={s.settingItem}>
                  <label className={s.settingLabel}>
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Layout mode</div>
                      <div className={s.settingDescription}>
                        Choose how the editor and output are arranged.
                      </div>
                      <select
                        value={layoutMode}
                        onChange={e =>
                          setLayoutMode(
                            e.target.value as 'split' | 'noodles-on-top' | 'output-on-top'
                          )
                        }
                        className={s.select}
                      >
                        <option value="split">Split</option>
                        <option value="noodles-on-top">Noodles on Top</option>
                        <option value="output-on-top">Output on Top</option>
                      </select>
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Privacy & Analytics Section */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>Privacy & Analytics</h3>

            <div className={s.settingItem}>
              <label className={s.settingLabel}>
                <input
                  type="checkbox"
                  checked={analyticsEnabled}
                  onChange={e => handleAnalyticsToggle(e.target.checked)}
                  className={s.checkbox}
                />
                <div className={s.settingContent}>
                  <div className={s.settingName}>Share anonymous usage data</div>
                  <div className={s.settingDescription}>
                    Help improve Noodles.gl by sharing anonymous feature usage data. We never
                    collect your project data, node content, API keys, or personal information.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className={s.footer}>
            <Dialog.Close asChild>
              <button type="button" className={s.closeButton}>
                Close
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
