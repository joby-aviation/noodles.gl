import { useReactFlow, type Node } from '@xyflow/react'
import cx from 'classnames'
import { matchSorter } from 'match-sorter'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import s from './block-library.module.css'
import { type MathOpType, mathOps, type OpType, opTypes } from '../operators'
import { useSlice } from '../store'
import { edgeId, nodeId } from '../utils/id-utils'
import { headerClass, typeCategory, typeDisplayName } from './op-components'
import type { NodeType } from './add-node-menu'

export interface BlockLibraryRef {
  openModal: () => void
  closeModal: () => void
}

type BlockLibraryProps = {
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export const BlockLibrary = forwardRef<BlockLibraryRef, BlockLibraryProps>(
  ({ reactFlowRef }, ref) => {
    const { addNodes, addEdges, screenToFlowPosition } = useReactFlow()
    const [isOpen, setIsOpen] = useState(false)
    const { currentContainerId } = useSlice(state => state.nesting)
    const [searchText, setSearchText] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const mousePositionRef = useRef<{ x: number; y: number } | null>(null)

    const onCloseModal = useCallback(() => {
      setIsOpen(false)
      setSearchText('')
      setSelectedCategory(null)
    }, [])

    const onOpenModal = useCallback(() => {
      setIsOpen(true)
    }, [])

    // Track mouse position for node placement
    useEffect(() => {
      const pane = reactFlowRef.current
      if (!pane) return

      const handleMouseMove = (e: MouseEvent) => {
        const rect = pane.getBoundingClientRect()
        mousePositionRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        }
      }

      const handleMouseLeave = () => {
        mousePositionRef.current = null
      }

      pane.addEventListener('mousemove', handleMouseMove)
      pane.addEventListener('mouseleave', handleMouseLeave)

      return () => {
        pane.removeEventListener('mousemove', handleMouseMove)
        pane.removeEventListener('mouseleave', handleMouseLeave)
      }
    }, [reactFlowRef])

    const addNode = (e: React.MouseEvent<HTMLDivElement>, type: NodeType) => {
      const pane = reactFlowRef.current?.getBoundingClientRect()
      if (!pane) return

      const mousePos = mousePositionRef.current

      // Use mouse position if available, otherwise center
      let x: number, y: number
      if (mousePos && mousePos.x >= 0 && mousePos.x <= pane.width && mousePos.y >= 0 && mousePos.y <= pane.height) {
        const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        x = flowPos.x
        y = flowPos.y
      } else {
        const flowPos = screenToFlowPosition({ x: pane.width / 2, y: pane.height / 2 })
        x = flowPos.x
        y = flowPos.y
      }

      function makeOpId(type: OpType, containerId: string = currentContainerId) {
        const baseName = toKebabCase(type.replace(/Op$/g, ''))
        return nodeId(baseName, containerId)
      }

      function toKebabCase(str: string): string {
        return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
      }
      const nodes: NodeJSON<unknown>[] = []
      const edges = []

      if (type === 'ForLoop') {
        const bodyId = nodeId('for-loop-body', currentContainerId)
        const beginNode = {
          id: makeOpId('ForLoopBeginOp', currentContainerId),
          type: 'ForLoopBeginOp',
          data: undefined,
          parentNode: bodyId,
          expandParent: true,
          position: { x: 0, y: 100 },
        }
        const endNode = {
          id: makeOpId('ForLoopEndOp', currentContainerId),
          type: 'ForLoopEndOp',
          data: undefined,
          parentNode: bodyId,
          expandParent: true,
          position: { x: 900, y: 100 },
        }
        nodes.push({
          id: bodyId,
          type: 'group',
          selectable: false,
          draggable: false,
          style: { width: 1200, height: 300 },
          position: { x, y },
        } as NodeJSON<'group'>)
        nodes.push(beginNode)
        nodes.push(endNode)
        edges.push({
          id: edgeId({
            source: beginNode.id,
            sourceHandle: 'd',
            target: endNode.id,
            targetHandle: 'd',
          }),
          source: beginNode.id,
          target: endNode.id,
          sourceHandle: 'd',
          targetHandle: 'd',
        })
      } else if (type === 'ContainerOp') {
        const id = nodeId('container', currentContainerId)
        const containerInputId = nodeId('container-input', id)
        const containerOutputId = nodeId('container-output', id)
        nodes.push(
          {
            id,
            type,
            data: undefined,
            position: { x, y },
          },
          {
            id: containerInputId,
            type: 'GraphInputOp',
            position: { x: -700, y: 0 },
          },
          {
            id: containerOutputId,
            type: 'GraphOutputOp',
            position: { x: 0, y: 0 },
          }
        )
        const inputSourceHandle = 'par.in'
        const inputTargetHandle = 'par.parentValue'

        const inEdge = {
          source: id,
          sourceHandle: inputSourceHandle,
          target: containerInputId,
          targetHandle: inputTargetHandle,
        }

        const outputSourceHandle = 'out.propagatedValue'
        const outputTargetHandle = 'out.out'

        const outEdge = {
          source: containerOutputId,
          sourceHandle: outputSourceHandle,
          target: id,
          targetHandle: outputTargetHandle,
        }
        edges.push({ ...inEdge, id: edgeId(inEdge) }, { ...outEdge, id: edgeId(outEdge) })
      } else if (mathOps[type]) {
        const operator = mathOps[type] as MathOpType
        nodes.push({
          id: nodeId(operator, currentContainerId),
          type: 'MathOp',
          data: {
            inputs: { operator },
          },
          position: { x, y },
        })
      } else {
        nodes.push({ type, id: makeOpId(type, currentContainerId), position: { x, y } })
      }

      addNodes(nodes)
      addEdges(edges)
      onCloseModal()
    }

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      openModal: onOpenModal,
      closeModal: onCloseModal,
    }))

    const onSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchText(e.target.value)
    }

    const options = useMemo(() => {
      return (Object.keys(opTypes) as NodeType[])
        .filter(type => type !== 'ForLoopBeginOp' && type !== 'ForLoopEndOp')
        .concat(['ForLoop', ...Object.keys(mathOps)])
        .sort()
    }, [])

    // Get all unique categories
    const categories = useMemo(() => {
      const categorySet = new Set<string>()
      for (const type of options) {
        categorySet.add(typeCategory(type))
      }
      return Array.from(categorySet).sort()
    }, [options])

    // Filter by search and category, then group by category
    const groupedOptions = useMemo(() => {
      let results = options

      // Filter by search text
      if (searchText) {
        results = matchSorter(results, searchText)
      }

      // Filter by category
      if (selectedCategory) {
        results = results.filter(type => typeCategory(type) === selectedCategory)
      }

      // Group by category
      const grouped = new Map<string, NodeType[]>()
      for (const type of results) {
        const category = typeCategory(type)
        if (!grouped.has(category)) {
          grouped.set(category, [])
        }
        grouped.get(category)!.push(type)
      }

      // Sort within each category alphabetically by display name
      for (const types of grouped.values()) {
        types.sort((a, b) => {
          const displayNameA = opTypes[a]?.displayName || typeDisplayName(a)
          const displayNameB = opTypes[b]?.displayName || typeDisplayName(b)
          return displayNameA.localeCompare(displayNameB)
        })
      }

      // Return as sorted array of [category, types] pairs
      return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    }, [options, searchText, selectedCategory])

    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
      if (isOpen) {
        inputRef.current?.focus()
      }
    }, [isOpen])

    // Handle Tab key to open modal and Escape to close
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          e.preventDefault()
          if (isOpen) {
            onCloseModal()
          } else {
            onOpenModal()
          }
        } else if (e.key === 'Escape' && isOpen) {
          onCloseModal()
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onCloseModal, onOpenModal])

    if (!isOpen) return null

    return (
      <div className={s.blockLibraryOverlay} onClick={onCloseModal}>
        <div className={s.blockLibraryModal} onClick={e => e.stopPropagation()}>
          <div className={s.blockLibrarySidebar}>
            <div className={s.blockLibraryHeader}>Block Library</div>
            <input
              ref={inputRef}
              type="text"
              className={s.blockLibrarySearchBox}
              placeholder="Search operators..."
              value={searchText}
              onChange={onSearch}
            />
            <div className={s.blockLibraryCategoriesHeader}>Categories</div>
            <div className={s.blockLibraryCategories}>
              <button
                className={cx(s.blockLibraryCategoryItem, {
                  [s.blockLibraryCategoryItemActive]: selectedCategory === null,
                })}
                onClick={() => setSelectedCategory(null)}
              >
                All
              </button>
              {categories.map(category => (
                <button
                  key={category}
                  className={cx(s.blockLibraryCategoryItem, {
                    [s.blockLibraryCategoryItemActive]: selectedCategory === category,
                  })}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
          <div className={s.blockLibraryContent}>
            {groupedOptions.map(([category, types]) => (
              <div key={category}>
                <div className={s.blockLibraryContentCategoryHeader}>{category}</div>
                <div className={s.blockLibraryGrid}>
                  {types.map(type => {
                    const description = opTypes[type]?.description
                    const displayName = opTypes[type]?.displayName || typeDisplayName(type)
                    return (
                      <div
                        key={type}
                        className={s.blockLibraryCard}
                        role="button"
                        tabIndex={0}
                        onClick={e => addNode(e, type)}
                        onKeyDown={e => e.key === 'Enter' && addNode(e, type)}
                      >
                        <div className={s.blockLibraryCardHeader}>
                          <div className={s.blockLibraryCardTitle}>{displayName}</div>
                          <div className={cx(s.blockLibraryCardCategory, headerClass(type))}>
                            {category}
                          </div>
                        </div>
                        {description && (
                          <div className={s.blockLibraryCardDescription}>{description}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
)
