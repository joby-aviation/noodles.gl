import * as Tooltip from '@radix-ui/react-tooltip'
import studio from '@theatre/studio'
import { useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { useCallback, useMemo, useRef, useState } from 'react'
import { analytics } from '../../utils/analytics'
import type { IOperator, Operator } from '../operators'
import { getOpStore, hasOp, useNestingStore, useOperatorStore } from '../store'
import { generateQualifiedPath, getBaseName } from '../utils/path-utils'
import { categories } from './categories'
import s from './node-tree-sidebar.module.css'

// Map operator displayName to category for color coding
function getOperatorCategory(displayName: string): string | null {
  for (const [category, operators] of Object.entries(categories)) {
    if ((operators as readonly string[]).includes(displayName)) {
      return category
    }
  }
  return null
}

interface TreeNode {
  id: string
  name: string
  displayName: string
  children: TreeNode[]
  depth: number
}

// Build hierarchical tree from flat operator list
function buildTree(operators: Map<string, Operator<IOperator>>): TreeNode[] {
  const tree: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  // Sort operators by path to ensure parents come before children
  const sortedOps = Array.from(operators.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  for (const [id, op] of sortedOps) {
    const { displayName } = op.constructor as typeof Operator
    const pathParts = id.split('/').filter(Boolean)
    const name = getBaseName(id) || 'root'
    const depth = pathParts.length

    const node: TreeNode = {
      id,
      name,
      displayName,
      children: [],
      depth,
    }

    nodeMap.set(id, node)

    // Find parent
    if (pathParts.length > 1) {
      const parentPath = `/${pathParts.slice(0, -1).join('/')}`
      const parent = nodeMap.get(parentPath)
      if (parent) {
        parent.children.push(node)
      } else {
        // Parent doesn't exist yet, add to root
        tree.push(node)
      }
    } else {
      tree.push(node)
    }
  }

  return tree
}

interface TreeItemProps {
  node: TreeNode
  selectedNodeIds: Set<string>
  onSelect: (id: string) => void
  onNavigate: (id: string) => void
  onNavigateInto: (id: string) => void
  collapsedNodes: Set<string>
  onToggleCollapse: (id: string) => void
  updateOperatorId: (nodeId: string, newBaseName: string, isContainer: boolean) => void
}

function TreeItem({
  node,
  selectedNodeIds,
  onSelect,
  onNavigate,
  onNavigateInto,
  collapsedNodes,
  onToggleCollapse,
  updateOperatorId,
}: TreeItemProps) {
  const [hovering, setHovering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [hasConflict, setHasConflict] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasChildren = node.children.length > 0
  const isContainer = node.displayName === 'Container'
  const isCollapsed = collapsedNodes.has(node.id)
  const isSelected = selectedNodeIds.has(node.id)

  // Get the category color for this operator displayName
  const category = getOperatorCategory(node.displayName)
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
      if (!newBaseName.trim()) return false
      const store = getOpStore()
      const op = store.getOp(node.id)
      if (!op) return false
      const newQualifiedId = generateQualifiedPath(newBaseName.trim(), op.containerId ?? '/')
      return newQualifiedId !== node.id && hasOp(newQualifiedId)
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

      updateOperatorId(node.id, trimmedName, isContainer)

      setEditing(false)
      setHasConflict(false)
      setInputValue('')
    },
    [node.id, isContainer, checkForConflict, updateOperatorId]
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
              updateOperatorId={updateOperatorId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface NodeTreeSidebarProps {
  updateOperatorId: (nodeId: string, newBaseName: string, isContainer: boolean) => void
}

export function NodeTreeSidebar({ updateOperatorId }: NodeTreeSidebarProps) {
  const operators = useOperatorStore(state => state.operators)
  const reactFlow = useReactFlow()
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())

  // Build tree from operators
  const tree = useMemo(() => buildTree(operators), [operators])

  // Get selected node IDs from React Flow (reactive)
  const nodes = reactFlow.getNodes()
  const selectedNodeIds = useMemo(() => {
    return new Set(nodes.filter(n => n.selected).map(n => n.id))
  }, [nodes])

  const handleSelect = useCallback(
    (id: string) => {
      // Select in React Flow
      reactFlow.setNodes(nodes =>
        nodes.map(node => ({
          ...node,
          selected: node.id === id,
        }))
      )

      // Select in Theatre.js using the same method as onNodeClick
      const store = getOpStore()
      const obj = store.getSheetObject(id)
      if (obj) {
        studio.setSelection([obj])
      } else {
        studio.setSelection([])
      }
    },
    [reactFlow]
  )

  const handleNavigate = useCallback(
    (id: string) => {
      const nestingStore = useNestingStore.getState()
      const currentContainerId = nestingStore.currentContainerId

      // Navigate to the appropriate container level
      const pathParts = id.split('/').filter(Boolean)
      let targetContainerId: string
      if (pathParts.length > 1) {
        // Nested node: navigate to parent container
        targetContainerId = `/${pathParts.slice(0, -1).join('/')}`
        nestingStore.setCurrentContainerId(targetContainerId)
      } else {
        // Root level node: navigate to root
        targetContainerId = '/'
        nestingStore.setCurrentContainerId('/')
      }

      const isChangingLevels = currentContainerId !== targetContainerId

      // Track analytics if we're changing levels
      if (isChangingLevels) {
        // Determine direction: up if target is shallower than current
        const currentDepth = currentContainerId.split('/').filter(Boolean).length
        const targetDepth = targetContainerId.split('/').filter(Boolean).length
        const direction = targetDepth < currentDepth ? 'up' : 'into'
        analytics.track('container_navigated', { method: 'sidebar_target', direction })
      }

      // Use RAF to ensure React state updates have flushed
      requestAnimationFrame(() => {
        // Zoom to the specific node (instant if changing levels, animated if same level)
        reactFlow.fitView({
          nodes: [{ id }],
          duration: isChangingLevels ? 0 : 300,
          padding: 0.5,
        })
      })
    },
    [reactFlow]
  )

  const handleNavigateInto = useCallback(
    (id: string) => {
      const nestingStore = useNestingStore.getState()
      // Clear selection when changing levels
      reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
      nestingStore.setCurrentContainerId(id)
      analytics.track('container_navigated', { method: 'sidebar', direction: 'into' })
      // Use RAF to ensure React state updates have flushed
      requestAnimationFrame(() => {
        reactFlow.fitView({ duration: 0 })
      })
    },
    [reactFlow]
  )

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  return (
    <div className={s.treeContainer}>
      {tree.map(node => (
        <TreeItem
          key={node.id}
          node={node}
          selectedNodeIds={selectedNodeIds}
          onSelect={handleSelect}
          onNavigate={handleNavigate}
          onNavigateInto={handleNavigateInto}
          collapsedNodes={collapsedNodes}
          onToggleCollapse={handleToggleCollapse}
          updateOperatorId={updateOperatorId}
        />
      ))}
    </div>
  )
}
