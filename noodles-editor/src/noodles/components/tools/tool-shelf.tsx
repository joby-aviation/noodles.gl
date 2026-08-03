import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analytics } from '../../../utils/analytics'
import {
  GEO_RECIPES,
  type GeoRecipe,
  GROUP_ICONS,
  GROUP_LABELS,
  RECIPES_BY_GROUP,
  type RecipeGroup,
} from './geo-recipes'
import { useMapToolStore } from './map-tool-store'
import { computeVisibleCount } from './overflow'
import s from './tool-shelf.module.css'

// The shelf shows as many tool categories as fit, and moves the rest into a More menu.
// Widths are measured from a hidden copy of the row rendered at natural size, so the
// visible count reflects real button widths rather than an estimate.

interface ToolShelfProps {
  onOpenAddNode?: () => void
  onCreatePoint: () => void
  // Opens the file/URL importer dialog
  onImportFile: () => void
  // Opens the guided wizard for a recipe, including the source formats under Import
  onRunRecipe: (recipe: GeoRecipe) => void
}

// Categories that get their own top-level button. Sources are excluded because they
// live under the Import Data split button instead.
const SHELF_GROUPS: RecipeGroup[] = ['geometry', 'combine', 'analysis', 'transform', 'grid']

const SOURCE_RECIPES = GEO_RECIPES.filter(recipe => recipe.group === 'source')

// Space kept clear for the always-visible items (Import, Draw, Measure, More, Add Op)
const RESERVED_WIDTH = 330
const GAP = 4

export function ToolShelf({
  onOpenAddNode,
  onCreatePoint,
  onImportFile,
  onRunRecipe,
}: ToolShelfProps) {
  const activeTool = useMapToolStore(state => state.activeTool)
  const toggleTool = useMapToolStore(state => state.toggleTool)

  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(SHELF_GROUPS.length)

  const groups = useMemo(
    () =>
      SHELF_GROUPS.map(group => ({
        group,
        recipes: RECIPES_BY_GROUP.find(entry => entry.group === group)?.recipes ?? [],
      })).filter(entry => entry.recipes.length > 0),
    []
  )

  // Re-measure on resize. The hidden row always renders every group, so its children
  // give the natural width of each button regardless of what is currently visible.
  const remeasure = useCallback(() => {
    const row = rowRef.current
    const measurer = measureRef.current
    if (!row || !measurer) return
    const widths = Array.from(measurer.children).map(child => child.getBoundingClientRect().width)
    const available = row.getBoundingClientRect().width - RESERVED_WIDTH
    setVisibleCount(computeVisibleCount(widths, available, GAP))
  }, [])

  useEffect(() => {
    remeasure()
    const observer = new ResizeObserver(remeasure)
    if (rowRef.current) observer.observe(rowRef.current)
    return () => observer.disconnect()
  }, [remeasure])

  const visibleGroups = groups.slice(0, visibleCount)
  const overflowGroups = groups.slice(visibleCount)

  const runRecipe = useCallback(
    (recipe: GeoRecipe, source: string) => {
      analytics.track('geo_recipe_opened', { recipe: recipe.id, source })
      onRunRecipe(recipe)
    },
    [onRunRecipe]
  )

  return (
    <div className={s.shelf} ref={rowRef}>
      {/* Import is a split button: click imports a file, the caret picks a source format */}
      <div className={s.splitButton}>
        <button type="button" className={s.splitMain} onClick={onImportFile} title="Import data">
          <i className="pi pi-file-import" />
          <span className={s.label}>Import Data</span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className={s.splitCaret} aria-label="Choose a data source">
              <i className="pi pi-angle-down" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={s.menu} align="start" sideOffset={4}>
              <div className={s.menuLabel}>From file</div>
              <DropdownMenu.Item className={s.item} onSelect={onImportFile}>
                <i className={`pi pi-upload ${s.itemIcon}`} />
                <span className={s.itemText}>
                  <span className={s.itemName}>Browse or paste a URL</span>
                  <span className={s.itemSummary}>
                    CSV, JSON, GeoJSON, Shapefile, GeoParquet, PMTiles
                  </span>
                </span>
              </DropdownMenu.Item>
              <div className={s.menuLabel}>Add a source node</div>
              {SOURCE_RECIPES.map(recipe => (
                <DropdownMenu.Item
                  key={recipe.id}
                  className={s.item}
                  onSelect={() => runRecipe(recipe, 'import_split_button')}
                >
                  <i className={`${recipe.icon} ${s.itemIcon}`} />
                  <span className={s.itemText}>
                    <span className={s.itemName}>{recipe.name}</span>
                    <span className={s.itemSummary}>{recipe.summary}</span>
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <button type="button" className={s.button} onClick={onCreatePoint} title="Create a point">
        <i className="pi pi-map-marker" />
        <span className={s.label}>Point</span>
      </button>

      <div className={s.divider} />

      {/* Draw and Measure arm an on-map tool rather than opening a dialog */}
      <button
        type="button"
        className={activeTool === 'draw' ? s.buttonActive : s.button}
        onClick={() => {
          toggleTool('draw')
          analytics.track('map_tool_toggled', { tool: 'draw' })
        }}
        title="Draw geometry on the map"
        aria-pressed={activeTool === 'draw'}
      >
        <i className="pi pi-pencil" />
        <span className={s.label}>Draw</span>
      </button>

      <button
        type="button"
        className={activeTool === 'measure' ? s.buttonActive : s.button}
        onClick={() => {
          toggleTool('measure')
          analytics.track('map_tool_toggled', { tool: 'measure' })
        }}
        title="Measure distance or area on the map"
        aria-pressed={activeTool === 'measure'}
      >
        <i className="pi pi-arrows-h" />
        <span className={s.label}>Measure</span>
      </button>

      <div className={s.divider} />

      {visibleGroups.map(({ group, recipes }) => (
        <GroupMenu
          key={group}
          group={group}
          recipes={recipes}
          onSelect={recipe => runRecipe(recipe, `shelf_${group}`)}
        />
      ))}

      {/* More is always present: it holds whatever overflowed plus a search over
          every recipe, which is the only way to reach one by name. */}
      <MoreMenu
        overflowGroups={overflowGroups}
        onSelect={recipe => runRecipe(recipe, 'shelf_more')}
      />

      <div className={s.divider} />

      {/* Last: adding a raw operator is the escape hatch, not the first thing to reach for */}
      <button
        type="button"
        className={s.button}
        onClick={onOpenAddNode}
        disabled={!onOpenAddNode}
        title="Add any operator"
      >
        <i className="pi pi-plus-circle" />
        <span className={s.label}>Add Op</span>
      </button>

      {/* Hidden measurement row: every group at natural width, never shown to the user */}
      <div className={s.measurer} ref={measureRef} aria-hidden="true">
        {groups.map(({ group }) => (
          <button type="button" className={s.button} key={group} tabIndex={-1}>
            <i className={GROUP_ICONS[group]} />
            <span className={s.label}>{GROUP_LABELS[group]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function GroupMenu({
  group,
  recipes,
  onSelect,
}: {
  group: RecipeGroup
  recipes: GeoRecipe[]
  onSelect: (recipe: GeoRecipe) => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={s.button} title={GROUP_LABELS[group]}>
          <i className={GROUP_ICONS[group]} />
          <span className={s.label}>{GROUP_LABELS[group]}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.menu} align="start" sideOffset={4}>
          {recipes.map(recipe => (
            <DropdownMenu.Item key={recipe.id} className={s.item} onSelect={() => onSelect(recipe)}>
              <i className={`${recipe.icon} ${s.itemIcon}`} />
              <span className={s.itemText}>
                <span className={s.itemName}>{recipe.name}</span>
                <span className={s.itemSummary}>{recipe.summary}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MoreMenu({
  overflowGroups,
  onSelect,
}: {
  overflowGroups: { group: RecipeGroup; recipes: GeoRecipe[] }[]
  onSelect: (recipe: GeoRecipe) => void
}) {
  const [query, setQuery] = useState('')

  // Search spans every recipe, including ones reachable from a visible group button,
  // so typing a name always finds it wherever it happens to live right now.
  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return null
    return GEO_RECIPES.filter(
      recipe =>
        recipe.name.toLowerCase().includes(trimmed) ||
        recipe.summary.toLowerCase().includes(trimmed) ||
        GROUP_LABELS[recipe.group].toLowerCase().includes(trimmed)
    )
  }, [query])

  return (
    <DropdownMenu.Root onOpenChange={open => !open && setQuery('')}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={s.button} title="Search all tools">
          <i className="pi pi-ellipsis-h" />
          <span className={s.label}>More</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.menu} align="end" sideOffset={4}>
          <div className={s.searchRow}>
            <i className="pi pi-search" />
            <input
              className={s.search}
              placeholder="Search all GIS tools"
              value={query}
              onChange={event => setQuery(event.target.value)}
              // Radix would otherwise treat typing as menu type-ahead navigation
              onKeyDown={event => event.stopPropagation()}
            />
          </div>

          {matches ? (
            <>
              {matches.length === 0 && <div className={s.empty}>No tools match "{query}"</div>}
              {matches.map(recipe => (
                <DropdownMenu.Item
                  key={recipe.id}
                  className={s.item}
                  onSelect={() => onSelect(recipe)}
                >
                  <i className={`${recipe.icon} ${s.itemIcon}`} />
                  <span className={s.itemText}>
                    <span className={s.itemName}>{recipe.name}</span>
                    <span className={s.itemSummary}>{recipe.summary}</span>
                  </span>
                  <span className={s.itemGroup}>{GROUP_LABELS[recipe.group]}</span>
                </DropdownMenu.Item>
              ))}
            </>
          ) : (
            (overflowGroups.length > 0 ? overflowGroups : RECIPES_BY_GROUP).map(
              ({ group, recipes }) => (
                <DropdownMenu.Sub key={group}>
                  <DropdownMenu.SubTrigger className={s.subTrigger}>
                    <i className={`${GROUP_ICONS[group]} ${s.itemIcon}`} />
                    <span className={s.itemName}>{GROUP_LABELS[group]}</span>
                    <span className={s.count}>{recipes.length}</span>
                    <i className={`pi pi-angle-right ${s.chevron}`} />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={s.menu} sideOffset={2} alignOffset={-4}>
                      {recipes.map(recipe => (
                        <DropdownMenu.Item
                          key={recipe.id}
                          className={s.item}
                          onSelect={() => onSelect(recipe)}
                        >
                          <i className={`${recipe.icon} ${s.itemIcon}`} />
                          <span className={s.itemText}>
                            <span className={s.itemName}>{recipe.name}</span>
                            <span className={s.itemSummary}>{recipe.summary}</span>
                          </span>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              )
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
