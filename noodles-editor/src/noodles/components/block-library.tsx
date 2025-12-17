import { useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useNestingStore } from '../store'
import { createNodesForType, getNodeTypeOptions, type NodeType } from '../utils/node-creation-utils'
import s from './block-library.module.css'
import { getPopularOperators, rankNodeTypes } from './block-library-ranking'
import { getNodeDescription, headerClass, typeCategory, typeDisplayName } from './op-components'

export interface BlockLibraryRef {
  openModal: (screenX?: number, screenY?: number) => void
  closeModal: () => void
}

type BlockLibraryProps = {
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export const BlockLibrary = forwardRef<BlockLibraryRef, BlockLibraryProps>(
  ({ reactFlowRef }, ref) => {
    const { addNodes, addEdges, screenToFlowPosition } = useReactFlow()
    const [isOpen, setIsOpen] = useState(false)
    const currentContainerId = useNestingStore(state => state.currentContainerId)
    const [searchText, setSearchText] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    // Store the screen coordinates where the modal was opened
    const [openScreenPosition, setOpenScreenPosition] = useState<{ x: number; y: number } | null>(
      null
    )
    // Track selected index for keyboard navigation
    const [selectedIndex, setSelectedIndex] = useState(0)

    const onCloseModal = useCallback(() => {
      setIsOpen(false)
      setSearchText('')
      setSelectedCategory(null)
      setOpenScreenPosition(null)
      setSelectedIndex(0)
    }, [])

    const onOpenModal = useCallback((screenX?: number, screenY?: number) => {
      // Capture the current mouse/click position when opening
      if (screenX !== undefined && screenY !== undefined) {
        setOpenScreenPosition({ x: screenX, y: screenY })
      } else {
        setOpenScreenPosition(null)
      }
      setIsOpen(true)
    }, [])

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      openModal: onOpenModal,
      closeModal: onCloseModal,
    }))

    // Track last mouse position to use when 'a' is pressed
    const lastMousePosRef = useRef<{ x: number; y: number } | null>(null)

    useEffect(() => {
      const pane = reactFlowRef.current
      if (!pane) return

      const handleMouseMove = (e: MouseEvent) => {
        lastMousePosRef.current = { x: e.clientX, y: e.clientY }
      }

      pane.addEventListener('mousemove', handleMouseMove)
      return () => pane.removeEventListener('mousemove', handleMouseMove)
    }, [reactFlowRef])

    const addNode = (type: NodeType) => {
      const pane = reactFlowRef.current?.getBoundingClientRect()
      if (!pane) return

      // Use the position where the modal was opened, or center of the pane
      let position: { x: number; y: number }
      if (openScreenPosition) {
        position = screenToFlowPosition(openScreenPosition)
      } else {
        // Fallback to center of the pane
        position = screenToFlowPosition({
          x: pane.left + pane.width / 2,
          y: pane.top + pane.height / 2,
        })
      }

      const { nodes, edges } = createNodesForType(type, position, currentContainerId)
      addNodes(nodes)
      addEdges(edges)
      onCloseModal()
    }

    const onSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchText(e.target.value)
      setSelectedIndex(0) // Reset selection when search changes
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

    // Get results - either grouped by category (no search) or flat ranked list (with search)
    const displayMode = useMemo<
      | { mode: 'ranked'; results: NodeType[] }
      | { mode: 'grouped'; groups: Array<{ category: string; types: NodeType[] }> }
    >(() => {
      let results = options

      // Filter by category first
      if (selectedCategory) {
        results = results.filter(type => typeCategory(type) === selectedCategory)
      }

      // If there's a search term, use ranked mode
      if (searchText) {
        const ranked = rankNodeTypes(results, searchText)
        return { mode: 'ranked', results: ranked.map(r => r.type) }
      }

      // If no search term, use grouped mode with popular operators as first category
      const popular = getPopularOperators(results)
      const groups: Array<{ category: string; types: NodeType[] }> = []

      // Add "Popular" category at the top
      if (popular.length > 0) {
        groups.push({ category: 'Popular', types: popular })
      }

      // Group all operators by category (including popular ones in their own categories)
      const categoryMap = new Map<string, NodeType[]>()
      for (const type of results) {
        const category = typeCategory(type)
        if (!categoryMap.has(category)) {
          categoryMap.set(category, [])
        }
        categoryMap.get(category)!.push(type)
      }

      // Sort categories alphabetically and types within each category
      const sortedCategories = Array.from(categoryMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, types]) => ({
          category,
          types: types.sort((a, b) => typeDisplayName(a).localeCompare(typeDisplayName(b))),
        }))

      groups.push(...sortedCategories)

      return { mode: 'grouped', groups }
    }, [options, searchText, selectedCategory])

    // Flatten results for keyboard navigation
    const flatResults = useMemo(() => {
      if (displayMode.mode === 'ranked') {
        return displayMode.results
      }
      return displayMode.groups.flatMap(g => g.types)
    }, [displayMode])

    const inputRef = useRef<HTMLInputElement>(null)
    const cardRefs = useRef<Map<number, HTMLElement>>(new Map())
    const contentRef = useRef<HTMLDivElement>(null)
    const [inputMode, setInputMode] = useState<'keyboard' | 'mouse'>('mouse')

    useEffect(() => {
      if (isOpen) {
        inputRef.current?.focus()
        // Start in mouse mode
        setInputMode('mouse')
      }
    }, [isOpen])

    // Switch to mouse mode only when mouse actually moves
    useEffect(() => {
      if (!isOpen) return

      const handleMouseMove = (e: MouseEvent) => {
        const lastPos = lastMousePosRef.current
        const currentPos = { x: e.clientX, y: e.clientY }

        // Only switch to mouse mode if cursor actually moved
        if (!lastPos || lastPos.x !== currentPos.x || lastPos.y !== currentPos.y) {
          setInputMode('mouse')
          lastMousePosRef.current = currentPos
        }
      }

      const contentEl = contentRef.current
      if (contentEl) {
        contentEl.addEventListener('mousemove', handleMouseMove)
        return () => contentEl.removeEventListener('mousemove', handleMouseMove)
      }
    }, [isOpen])

    // Helper to scroll selected card into view (only called by keyboard navigation)
    const scrollToSelected = useCallback((index: number) => {
      const selectedCard = cardRefs.current.get(index)
      if (selectedCard) {
        selectedCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, [])

    // Handle mouse enter on cards (only when in mouse mode)
    const handleCardMouseEnter = useCallback(
      (index: number) => {
        if (inputMode === 'mouse') {
          setSelectedIndex(index)
        }
      },
      [inputMode]
    )

    // Handle keyboard navigation (2D grid with 3 columns)
    useEffect(() => {
      if (!isOpen) return

      const COLS = 3
      const totalResults = flatResults.length

      const handleKeyDown = (e: KeyboardEvent) => {
        // Close on Escape
        if (e.key === 'Escape') {
          onCloseModal()
          return
        }

        // Add selected result on Enter
        if (e.key === 'Enter' && totalResults > 0) {
          e.preventDefault()
          addNode(flatResults[selectedIndex])
          return
        }

        // 2D grid navigation with arrow keys
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setInputMode('keyboard')
          setSelectedIndex(prev => {
            const newIndex = Math.min(prev + COLS, totalResults - 1)
            scrollToSelected(newIndex)
            return newIndex
          })
          return
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setInputMode('keyboard')
          setSelectedIndex(prev => {
            const newIndex = Math.max(prev - COLS, 0)
            scrollToSelected(newIndex)
            return newIndex
          })
          return
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setInputMode('keyboard')
          setSelectedIndex(prev => {
            const newIndex = Math.min(prev + 1, totalResults - 1)
            scrollToSelected(newIndex)
            return newIndex
          })
          return
        }

        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setInputMode('keyboard')
          setSelectedIndex(prev => {
            const newIndex = Math.max(prev - 1, 0)
            scrollToSelected(newIndex)
            return newIndex
          })
          return
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
      // biome-ignore lint/correctness/useExhaustiveDependencies: addNode and setInputMode are stable from parent context
    }, [isOpen, onCloseModal, flatResults, selectedIndex, addNode, scrollToSelected])

    if (!isOpen) return null

    return createPortal(
      // biome-ignore lint/a11y/noStaticElementInteractions: overlay backdrop for modal
      <div className={s.blockLibraryOverlay} onClick={onCloseModal}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: modal content container */}
        <div className={s.blockLibraryModal} onClick={e => e.stopPropagation()}>
          <div className={s.blockLibrarySidebar} data-input-mode={inputMode}>
            <div className={s.blockLibraryHeader}>Operator Library</div>
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
                type="button"
                className={cx(s.blockLibraryCategoryItem, {
                  [s.blockLibraryCategoryItemActive]: selectedCategory === null,
                })}
                onClick={() => setSelectedCategory(null)}
              >
                All
              </button>
              {categories.map(category => (
                <button
                  type="button"
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
          <div ref={contentRef} className={s.blockLibraryContent} data-input-mode={inputMode}>
            {displayMode.mode === 'ranked' ? (
              // Ranked mode: flat list sorted by relevance
              <div className={s.blockLibraryGrid}>
                {displayMode.results.map((type, index) => {
                  const description = getNodeDescription(type)
                  const displayName = typeDisplayName(type)
                  const category = typeCategory(type)
                  const isSelected = index === selectedIndex

                  return (
                    <button
                      type="button"
                      key={type}
                      ref={el => {
                        if (el) {
                          cardRefs.current.set(index, el)
                        } else {
                          cardRefs.current.delete(index)
                        }
                      }}
                      className={cx(s.blockLibraryCard, {
                        [s.blockLibraryCardSelected]: isSelected,
                      })}
                      onClick={() => addNode(type)}
                      onKeyDown={e => e.key === 'Enter' && addNode(type)}
                      onMouseEnter={() => handleCardMouseEnter(index)}
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
                    </button>
                  )
                })}
              </div>
            ) : (
              // Grouped mode: organized by categories
              (() => {
                let cumulativeIndex = 0
                return displayMode.groups.map(group => {
                  const groupStartIndex = cumulativeIndex
                  cumulativeIndex += group.types.length

                  return (
                    <div key={group.category}>
                      <div className={s.blockLibraryContentCategoryHeader}>{group.category}</div>
                      <div className={s.blockLibraryGrid}>
                        {group.types.map((type, indexInGroup) => {
                          const globalIndex = groupStartIndex + indexInGroup
                        const description = getNodeDescription(type)
                        const displayName = typeDisplayName(type)
                        const category = typeCategory(type)
                        const isSelected = globalIndex === selectedIndex

                        return (
                          <button
                            type="button"
                            key={type}
                            ref={el => {
                              if (el) {
                                cardRefs.current.set(globalIndex, el)
                              } else {
                                cardRefs.current.delete(globalIndex)
                              }
                            }}
                            className={cx(s.blockLibraryCard, {
                              [s.blockLibraryCardSelected]: isSelected,
                            })}
                            onClick={() => addNode(type)}
                            onKeyDown={e => e.key === 'Enter' && addNode(type)}
                            onMouseEnter={() => handleCardMouseEnter(globalIndex)}
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
                          </button>
                        )
                        })}
                      </div>
                    </div>
                  )
                })
              })()
            )}
          </div>
        </div>
      </div>,
      document.body
    )
  }
)
