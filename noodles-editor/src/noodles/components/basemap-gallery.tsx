import { useState, useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import {
  BASEMAP_CATALOG,
  BASEMAP_PROVIDERS,
  BASEMAP_CATEGORIES,
  rasterUrlToStyle,
  type BasemapCategory,
  type BasemapEntry,
} from '../../utils/map-styles'
import s from './basemap-gallery.module.css'

interface BasemapGalleryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (value: string | object) => void
  currentValue?: string
}

export function BasemapGallery({ open, onOpenChange, onSelect, currentValue }: BasemapGalleryProps) {
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | BasemapCategory>('all')

  const filtered = useMemo(() => {
    let items = BASEMAP_CATALOG
    if (providerFilter !== 'all') {
      items = items.filter(b => b.provider === providerFilter)
    }
    if (categoryFilter !== 'all') {
      items = items.filter(b => b.category === categoryFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(
        b =>
          b.name.toLowerCase().includes(q) ||
          b.provider.toLowerCase().includes(q) ||
          b.category.includes(q)
      )
    }
    return items
  }, [search, providerFilter, categoryFilter])

  const handleSelect = (entry: BasemapEntry) => {
    if (entry.type === 'raster') {
      onSelect(rasterUrlToStyle(entry.url))
    } else {
      onSelect(entry.url)
    }
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <div className={s.header}>
            <Dialog.Title className={s.title}>Basemaps</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={s.closeButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </div>

          <div className={s.filters}>
            <input
              type="text"
              className={s.searchInput}
              placeholder="Search basemaps..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <select
              className={s.filterSelect}
              value={providerFilter}
              onChange={e => setProviderFilter(e.target.value)}
            >
              <option value="all">All providers</option>
              {BASEMAP_PROVIDERS.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className={s.filterSelect}
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value as 'all' | BasemapCategory)}
            >
              <option value="all">All categories</option>
              {BASEMAP_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className={s.count}>{filtered.length} basemaps</div>

          <div className={s.list}>
            {filtered.length === 0 ? (
              <div className={s.emptyState}>No basemaps match your filters</div>
            ) : (
              filtered.map(entry => (
                <button
                  key={entry.url}
                  type="button"
                  className={`${s.item} ${currentValue === entry.url ? s.itemActive : ''}`}
                  onClick={() => handleSelect(entry)}
                >
                  <div className={s.itemInfo}>
                    <span className={s.itemName}>{entry.name}</span>
                    <span className={s.itemMeta}>
                      {entry.provider} / {entry.category}
                      {entry.labels === false ? ' / no labels' : ''}
                    </span>
                  </div>
                  <div className={s.itemBadges}>
                    <span
                      className={`${s.badge} ${entry.type === 'vector' ? s.badgeVector : s.badgeRaster}`}
                    >
                      {entry.type}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
