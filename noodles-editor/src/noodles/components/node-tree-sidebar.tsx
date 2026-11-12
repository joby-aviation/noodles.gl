import { type EditorDoc, nameOf, OPERATOR_INDEX } from '@noodles.gl/planner'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renameNode } from '../../editor/doc-ops'
import { docStore, useEditor } from '../../editor/doc-store'
import { useUIStore } from '../../editor/ui-store'
import { analytics } from '../../utils/analytics'
import { categories } from './categories'
import s from './node-tree-sidebar.module.css'

// Planner categories as the editor's category colors
const CATEGORY_COLORS: Record<string, string> = {
  data: 'data',
  table: 'utility',
  rows: 'code',
  color: 'color',
  layer: 'layer',
  output: 'view',
  number: 'number',
  structure: 'grouping',
}

// A host operator's color is its Noodles category's, by display name
export function getOperatorCategory(op: string): string | null {
  const def = OPERATOR_INDEX.get(op)
  if (def && def.category !== 'host') return CATEGORY_COLORS[def.category] ?? null
  const displayName = def?.label ?? op.replace(/Op$/, '')
  for (const [category, operators] of Object.entries(categories)) {
    if ((operators as readonly string[]).includes(displayName)) return category
  }
  return null
}

interface TreeNode {
  id: string
  name: string
  displayName: string
  op: string
  /** A subnet: its children nest under it. */
  subnet: boolean
  children: TreeNode[]
  depth: number
}

// The document's nodes as a tree: a subnet's children under it, each level by name
function buildTree(doc: EditorDoc): TreeNode[] {
  const make = (parent: string | undefined, depth: number): TreeNode[] =>
    doc.nodes
      .filter(n => n.parent === parent)
      .map(n => ({
        id: n.id,
        name: nameOf(n),
        displayName: OPERATOR_INDEX.get(n.op)?.label ?? n.op,
        op: n.op,
        subnet: n.op === 'subnet',
        children: n.op === 'subnet' ? make(n.id, depth + 1) : [],
        depth,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  return make(undefined, 1)
}

interface TreeItemProps {
  node: TreeNode
  selectedNodeIds: Set<string>
  onSelect: (id: string) => void
  onNavigate: (id: string) => void
  onNavigateInto: (id: string) => void
  collapsedNodes: Set<string>
  onToggleCollapse: (id: string) => void
}

function TreeItem({
  node,
  selectedNodeIds,
  onSelect,
  onNavigate,
  onNavigateInto,
  collapsedNodes,
  onToggleCollapse,
}: TreeItemProps) {
  const [hovering, setHovering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [hasConflict, setHasConflict] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasChildren = node.children.length > 0
  const isContainer = node.subnet
  const isCollapsed = collapsedNodes.has(node.id)
  const isSelected = selectedNodeIds.has(node.id)

  // Get the category color for this operator displayName
  const category = getOperatorCategory(node.op)
  const borderColor = category ? `var(--node-${category}-color)` : 'transparent'

  // Auto-focus input when entering edit mode
  const handleEditingStart = useCallback(() => {
    setEditing(true)
    setInputValue(node.name)
    setHasConflict(false)
    // Focus input after it's rendered
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [node.name])

  // Check for duplicate names
  const checkForConflict = useCallback(
    (newBaseName: string): boolean => {
      const name = newBaseName.trim()
      if (!name) return false
      const { doc } = docStore().get()
      const self = doc.nodes.find(n => n.id === node.id)
      return doc.nodes.some(
        n => n.id !== node.id && n.parent === self?.parent && nameOf(n) === name
      )
    },
    [node.id]
  )

  const updateId = useCallback(
    (newBaseName: string) => {
      const trimmedName = newBaseName.trim()

      // If empty, just reset to original
      if (!trimmedName) {
        setEditing(false)
        setHasConflict(false)
        setInputValue('')
        return
      }

      // If conflict, show error briefly then reset
      if (checkForConflict(trimmedName)) {
        setHasConflict(true)
        setInputValue(trimmedName)
        // Show error for a moment, then reset
        setTimeout(() => {
          setEditing(false)
          setHasConflict(false)
          setInputValue('')
        }, 1500)
        return
      }

      if (trimmedName !== node.name) {
        docStore().edit(d => {
          renameNode(d, node.id, trimmedName)
        })
      }

      setEditing(false)
      setHasConflict(false)
      setInputValue('')
    },
    [node.id, node.name, checkForConflict]
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setInputValue(value)
      setHasConflict(checkForConflict(value))
    },
    [checkForConflict]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        updateId(e.currentTarget.value)
      } else if (e.key === 'Escape') {
        setEditing(false)
        setHasConflict(false)
        setInputValue('')
      }
    },
    [updateId]
  )

  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      updateId(e.currentTarget.value)
    },
    [updateId]
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleEditingStart()
    },
    [handleEditingStart]
  )

  const errorMessage = hasConflict ? `Duplicate name: ${inputValue} already exists` : ''

  return (
    <div className={s.treeItem}>
      {/* biome-ignore lint/a11y/useSemanticElements: Complex styling requires div */}
      <div
        role="button"
        tabIndex={0}
        className={`${s.treeItemContent} ${isSelected ? s.selected : ''}`}
        style={{
          paddingLeft: `${24 + (node.depth - 1) * 20}px`,
          borderLeft: `3px solid ${borderColor}`,
        }}
        onClick={() => onSelect(node.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(node.id)
          }
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {isContainer && hasChildren && (
          <button
            type="button"
            className={s.collapseButton}
            onClick={e => {
              e.stopPropagation()
              onToggleCollapse(node.id)
            }}
          >
            <i className={isCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'} />
          </button>
        )}
        {!isContainer && hasChildren && <span className={s.spacer} />}
        <div className={s.nodeInfo}>
          {editing ? (
            <Tooltip.Provider>
              <Tooltip.Root open={hasConflict}>
                <Tooltip.Trigger asChild>
                  <input
                    ref={inputRef}
                    className={cx(s.nodeName, s.nodeNameInput, {
                      [s.nodeNameInputError]: hasConflict,
                    })}
                    value={inputValue}
                    onChange={onInputChange}
                    onKeyDown={onKeyDown}
                    onBlur={onBlur}
                    onClick={e => e.stopPropagation()}
                  />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="bottom" className={s.tooltipContent}>
                    {errorMessage}
                    <Tooltip.Arrow className={s.tooltipArrow} />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          ) : (
            // biome-ignore lint/a11y/useSemanticElements: span needed for inline editable text
            <span className={s.nodeName} role="button" tabIndex={0} onDoubleClick={onDoubleClick}>
              {node.name}
            </span>
          )}
          <span className={s.nodeType}>{node.displayName}</span>
        </div>
        {hovering && (
          <>
            {isContainer && (
              <button
                type="button"
                className={s.navigateButton}
                onClick={e => {
                  e.stopPropagation()
                  onNavigateInto(node.id)
                }}
                title="Navigate into container"
              >
                <i className="pi pi-arrow-right" />
              </button>
            )}
            <button
              type="button"
              className={s.navigateButton}
              onClick={e => {
                e.stopPropagation()
                onNavigate(node.id)
              }}
              title="Navigate to node"
            >
              <i className="pi pi-compass" />
            </button>
          </>
        )}
      </div>
      {isContainer && !isCollapsed && (
        <div className={s.children}>
          {node.children.map(child => (
            <TreeItem
              key={child.id}
              node={child}
              selectedNodeIds={selectedNodeIds}
              onSelect={onSelect}
              onNavigate={onNavigate}
              onNavigateInto={onNavigateInto}
              collapsedNodes={collapsedNodes}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function NodeTreeSidebar() {
  const doc = useEditor(st => st.doc)
  const selection = useEditor(st => st.selection)
  const reactFlow = useReactFlow()
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const focusTrigger = useUIStore(state => state.sidebarSearchFocusTrigger)

  // Focus search input whenever the trigger increments
  useEffect(() => {
    if (focusTrigger > 0) searchInputRef.current?.focus()
  }, [focusTrigger])

  const tree = useMemo(() => buildTree(doc), [doc])

  // Flat filtered list when searching
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    const flat = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(n => [n, ...flat(n.children)])
    return flat(tree)
      .filter(n => n.name.toLowerCase().includes(q) || n.displayName.toLowerCase().includes(q))
      .map(n => ({ ...n, children: [], depth: 1 }))
  }, [searchQuery, tree])

  const selectedNodeIds = useMemo(() => new Set(selection), [selection])

  const handleSelect = useCallback((id: string) => {
    docStore().set({ selection: [id] })
  }, [])

  const handleNavigate = useCallback(
    (id: string) => {
      const store = docStore()
      const parent = store.get().doc.nodes.find(n => n.id === id)?.parent
      const isChangingLevels = store.get().network !== parent
      if (isChangingLevels) analytics.track('container_navigated', { method: 'sidebar_target' })
      store.set({ network: parent, selection: [id] })
      // Once the network has switched, zoom to the node
      requestAnimationFrame(() => {
        reactFlow.fitView({ nodes: [{ id }], duration: isChangingLevels ? 0 : 300, padding: 0.5 })
      })
    },
    [reactFlow]
  )

  const handleNavigateInto = useCallback(
    (id: string) => {
      docStore().set({ network: id, selection: [] })
      analytics.track('container_navigated', { method: 'sidebar', direction: 'into' })
      requestAnimationFrame(() => {
        reactFlow.fitView({ duration: 0 })
      })
    },
    [reactFlow]
  )

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const renderNodes = filteredNodes ?? tree

  return (
    <div className={s.treeContainer}>
      <div className={s.searchContainer}>
        <input
          ref={searchInputRef}
          className={s.searchInput}
          placeholder="Find node…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setSearchQuery('')
              searchInputRef.current?.blur()
            }
          }}
        />
        {searchQuery && (
          <button type="button" className={s.searchClear} onClick={() => setSearchQuery('')}>
            <i className="pi pi-times" />
          </button>
        )}
      </div>
      <div className={s.treeList}>
        {renderNodes.map(node => (
          <TreeItem
            key={node.id}
            node={node}
            selectedNodeIds={selectedNodeIds}
            onSelect={handleSelect}
            onNavigate={handleNavigate}
            onNavigateInto={handleNavigateInto}
            collapsedNodes={collapsedNodes}
            onToggleCollapse={handleToggleCollapse}
          />
        ))}
      </div>
    </div>
  )
}
