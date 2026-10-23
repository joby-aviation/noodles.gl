import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useCallback } from 'react'
import type { RenderSource } from '../../render/render-analytics'
import { useRenderProgressStore } from '../../render/render-progress-store'
import s from './export-button.module.css'

interface ExportButtonProps {
  // The deck node whose render settings the export uses; null when the project has none
  deckName: string | null
  isRendering: boolean
  // Both take the analytics source; the renderer tracks the export
  takeScreenshot?: (source?: RenderSource) => Promise<void>
  startRender?: (source?: RenderSource) => Promise<void>
}

// The top bar's Export control, so exporting doesn't depend on knowing the logo menu
// or the Out node's properties. Same actions as the menu's Take Screenshot and Start Render.
export function ExportButton({
  deckName,
  isRendering,
  takeScreenshot,
  startRender,
}: ExportButtonProps) {
  const percent = useRenderProgressStore(state => state.percent)

  // The menu can be open when another export starts (the export_video tool), so the
  // items and handlers check isRendering too, not just the trigger
  const handleTakeScreenshot = useCallback(async () => {
    if (!takeScreenshot || isRendering) return
    await takeScreenshot('toolbar')
  }, [takeScreenshot, isRendering])

  const handleStartRender = useCallback(async () => {
    if (!startRender || isRendering) return
    await startRender('toolbar')
  }, [startRender, isRendering])

  const disabledReason = isRendering
    ? 'An export is running'
    : !deckName
      ? 'Add a Deck node to export'
      : !takeScreenshot && !startRender
        ? 'Export is not available here'
        : null

  return (
    <DropdownMenu.Root>
      {/* The tooltip sits on a wrapper: a disabled button gets no hover events */}
      <span
        className={s.wrapper}
        title={disabledReason ?? `Export using ${deckName}'s render settings`}
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
          <div className={s.menuLabel}>Uses {deckName}'s render settings</div>
          <DropdownMenu.Item
            className={s.item}
            onSelect={handleTakeScreenshot}
            disabled={!takeScreenshot || isRendering}
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
            disabled={!startRender || isRendering}
          >
            <i className={`pi pi-video ${s.itemIcon}`} />
            <span className={s.itemText}>
              <span className={s.itemName}>
                {transparentVideo ? 'Video (WebM, transparent)' : 'Video (MP4)'}
              </span>
              <span className={s.itemSummary}>Render the timeline</span>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
