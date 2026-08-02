import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useMemo, useState } from 'react'
import {
  GEO_RECIPES,
  type GeoRecipe,
  GROUP_ICONS,
  GROUP_LABELS,
  RECIPES_BY_GROUP,
} from './geo-recipes'
import s from './geo-tool-menu.module.css'

interface GeoToolMenuProps {
  // Rendered as the dropdown trigger so the shelf keeps its own button styling
  children: React.ReactNode
  onSelectRecipe: (recipe: GeoRecipe) => void
}

export function GeoToolMenu({ children, onSelectRecipe }: GeoToolMenuProps) {
  const [query, setQuery] = useState('')

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
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.content} align="start" sideOffset={4}>
          <div className={s.searchRow}>
            <i className="pi pi-search" />
            <input
              className={s.search}
              placeholder="Search GIS tools"
              value={query}
              onChange={e => setQuery(e.target.value)}
              // Radix would otherwise treat typing as menu type-ahead navigation
              onKeyDown={e => e.stopPropagation()}
            />
          </div>

          {matches ? (
            <div className={s.results}>
              {matches.length === 0 && <div className={s.empty}>No tools match “{query}”</div>}
              {matches.map(recipe => (
                <DropdownMenu.Item
                  key={recipe.id}
                  className={s.item}
                  onSelect={() => onSelectRecipe(recipe)}
                >
                  <i className={`${recipe.icon} ${s.itemIcon}`} />
                  <span className={s.itemText}>
                    <span className={s.itemName}>{recipe.name}</span>
                    <span className={s.itemSummary}>{recipe.summary}</span>
                  </span>
                  <span className={s.itemGroup}>{GROUP_LABELS[recipe.group]}</span>
                </DropdownMenu.Item>
              ))}
            </div>
          ) : (
            RECIPES_BY_GROUP.map(({ group, recipes }) => (
              <DropdownMenu.Sub key={group}>
                <DropdownMenu.SubTrigger className={s.subTrigger}>
                  <i className={`${GROUP_ICONS[group]} ${s.itemIcon}`} />
                  <span className={s.itemName}>{GROUP_LABELS[group]}</span>
                  <span className={s.count}>{recipes.length}</span>
                  <i className={`pi pi-angle-right ${s.chevron}`} />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className={s.subContent} sideOffset={2} alignOffset={-4}>
                    {recipes.map(recipe => (
                      <DropdownMenu.Item
                        key={recipe.id}
                        className={s.item}
                        onSelect={() => onSelectRecipe(recipe)}
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
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
