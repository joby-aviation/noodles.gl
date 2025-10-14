import { useKeyPress, useReactFlow } from '@xyflow/react'
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
import s from '../noodles.module.css'
import { opTypes } from '../operators'
import { useSlice } from '../store'
import { createNodesForType, getNodeTypeOptions, type NodeType } from '../utils/node-creation-utils'
import { getNodeDescription, headerClass, typeCategory, typeDisplayName } from './op-components'

export type MenuState = {
  top: number
  left: number
  right: number
  bottom: number
}

export interface AddNodeMenuRef {
  openMenu: (position: MenuState) => void
  closeMenu: () => void
}

type AddNodeMenuProps = {
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export const AddNodeMenu = forwardRef<AddNodeMenuRef, AddNodeMenuProps>(({ reactFlowRef }, ref) => {
  const { addNodes, addEdges, screenToFlowPosition } = useReactFlow()
  const aPressed = useKeyPress('a')

  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const { currentContainerId } = useSlice(state => state.nesting)
  const mousePositionRef = useRef<{ x: number; y: number } | null>(null)

  const onCloseMenu = useCallback(() => {
    setMenuState(null)
    setSearchText('')
  }, [])

  // Track mouse position (Tab key now handled by BlockLibrary)
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

  useEffect(() => {
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return

    if (aPressed) {
      setMenuState({
        top: pane.height / 2 - 100,
        left: pane.width / 2 - 200,
        right: pane.width / 2 - 200,
        bottom: pane.height / 2 - 100,
      })
    }
  }, [aPressed, reactFlowRef])

  const addNode = (e: React.MouseEvent<HTMLDivElement>, type: NodeType) => {
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const { nodes, edges } = createNodesForType(type, position, currentContainerId)
    addNodes(nodes)
    addEdges(edges)
    onCloseMenu()
  }

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    openMenu: (position: MenuState) => {
      setMenuState(position)
    },
    closeMenu: () => {
      onCloseMenu()
    },
  }))

  const [searchText, setSearchText] = useState('')
  const onSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value)
  }

  const options = useMemo(() => getNodeTypeOptions(), [])

  // TODO: replace this and Geocoder with a typeahead / autocomplete component
  const searchResults = useMemo(() => {
    return matchSorter(options, searchText)
  }, [options, searchText])

  const inputRef = useRef<HTMLInputElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: we want to focus the input when the menu is open
  useEffect(() => {
    inputRef.current?.focus()
  }, [menuState])

  return menuState ? (
    <div className={s.addNodeMenu} style={{ ...menuState }}>
      <div className={s.addNodeMenuHeader}>Add Operator</div>
      <input
        ref={inputRef}
        type="text"
        className={s.addNodeSearchBox}
        placeholder="Search..."
        onChange={onSearch}
      />
      {searchResults.map(type => {
        const description = getNodeDescription(type)
        // Would be undefined for "aliased" ops like "Add" for "Math"
        const displayName = opTypes[type]?.displayName || typeDisplayName(type)
        return (
          <div
            key={type}
            className={s.addNodeMenuItem}
            role="button"
            tabIndex={0}
            onClick={e => addNode(e, type)}
            onKeyDown={e => e.key === 'Enter' && addNode(e, type)}
          >
            <div className={s.addNodeItemHeader}>
              <div>{displayName}</div>
              <div className={cx(s.nodeCategoryCapsule, headerClass(type))}>
                {typeCategory(type)}
              </div>
            </div>
            {description && <div className={s.addNodeItemDescription}>{description}</div>}
          </div>
        )
      })}
    </div>
  ) : null
}) // Only allow the node to be dragged by its header. This prevents issues with interacting with component bodies
