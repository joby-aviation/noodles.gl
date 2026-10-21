import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useCallback } from 'react'
import { useRenderProgressStore } from '../../render/render-progress-store'
import { analytics } from '../../utils/analytics'
import s from './export-button.module.css'

interface ExportButtonProps {
  // The OutOp whose render settings the export uses; null when the project has none
  activeOutOpId: string | null
  isRendering: boolean
  takeScreenshot?: () => Promise<void>
  startRender?: () => Promise<void>
}

// The top bar's Export control, so exporting doesn't depend on knowing the logo menu
// or the Out node's properties. Same actions as the menu's Take Screenshot and Start Render.
export function ExportButton({
  activeOutOpId,
  isRendering,
  takeScreenshot,
  startRender,
}: ExportButtonProps) {
  const percent = useRenderProgressStore(state => state.percent)

  const handleTakeScreenshot = useCallback(async () => {
    if (!takeScreenshot) return
    await takeScreenshot()
    analytics.track('screenshot_taken', { source: 'toolbar' })
  }, [takeScreenshot])

  const handleStartRender = useCallback(async () => {
    if (!startRender) return
    await startRender()
    analytics.track('render_started', { source: 'toolbar' })
  }, [startRender])

  const disabledReason = isRendering
    ? 'An export is running'
    : !activeOutOpId
      ? 'Add an Out node to export'
      : !takeScreenshot && !startRender
        ? 'Export is not available here'
        : null

  return (
    <DropdownMenu.Root>
      {/* The tooltip sits on a wrapper: a disabled button gets no hover events */}
      <span
        className={s.wrapper}
        title={disabledReason ?? `Export using ${activeOutOpId}'s render settings`}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={isRendering ? `${s.button} ${s.rendering}` : s.button}
            disabled={disabledReason !== null}
          >
            {isRendering ? (
              <>
                <span
                  className={s.progressFill}
                  style={{ width: `${percent ?? 0}%` }}
                  aria-hidden="true"
                />
                <i className="pi pi-spin pi-spinner" />
                <span className={s.label}>
                  {percent === null ? 'Exporting' : `Exporting ${percent}%`}
                </span>
              </>
            ) : (
              <>
                <i className="pi pi-download" />
                <span className={s.label}>Export</span>
                <i className={`pi pi-angle-down ${s.caret}`} />
              </>
            )}
          </button>
        </DropdownMenu.Trigger>
      </span>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.menu} align="end" sideOffset={5}>
          <div className={s.menuLabel}>Uses {activeOutOpId}'s render settings</div>
          <DropdownMenu.Item
            className={s.item}
            onSelect={handleTakeScreenshot}
            disabled={!takeScreenshot}
          >
            <i className={`pi pi-image ${s.itemIcon}`} />
            <span className={s.itemText}>
              <span className={s.itemName}>Image (PNG)</span>
              <span className={s.itemSummary}>Save the current frame</span>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={s.item}
            onSelect={handleStartRender}
            disabled={!startRender}
          >
            <i className={`pi pi-video ${s.itemIcon}`} />
            <span className={s.itemText}>
              <span className={s.itemName}>Video (MP4)</span>
              <span className={s.itemSummary}>Render the timeline</span>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
