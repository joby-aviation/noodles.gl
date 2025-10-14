import { useReactFlow } from '@xyflow/react'
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
import { opTypes } from '../operators'
import { useSlice } from '../store'
import { createNodesForType, getNodeTypeOptions, type NodeType } from '../utils/node-creation-utils'
import { getNodeDescription, headerClass, typeCategory, typeDisplayName } from './op-components'

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
      let position: { x: number; y: number }
      if (mousePos && mousePos.x >= 0 && mousePos.x <= pane.width && mousePos.y >= 0 && mousePos.y <= pane.height) {
        position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      } else {
        position = screenToFlowPosition({ x: pane.width / 2, y: pane.height / 2 })
      }

      const { nodes, edges } = createNodesForType(type, position, currentContainerId)
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

    const options = useMemo(() => getNodeTypeOptions(), [])

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
                    const description = getNodeDescription(type)
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
