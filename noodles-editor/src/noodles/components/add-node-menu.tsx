import type { NodeJSON } from 'SKIP-@xyflow/react'
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
import { type MathOpType, mathOps, type OpType, opTypes } from '../operators'
import { useSlice } from '../store'
import { edgeId, nodeId } from '../utils/id-utils'
import { headerClass, specialDescriptions, typeCategory, typeDisplayName } from './op-components'

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

export type NodeType = OpType | MathOpType | 'ForLoop'

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
    const { x, y } = screenToFlowPosition({ x: e.clientX, y: e.clientY })

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
      // Create a group node to contain the ForLoop body
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
      // TODO: refine "type" to not include types that would have been handled by earlier branches.
      // e.g. Op types would never make it to this point.
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

  const options = useMemo(() => {
    return (Object.keys(opTypes) as NodeType[])
      .filter(type => type !== 'ForLoopBeginOp' && type !== 'ForLoopEndOp')
      .concat(['ForLoop', ...Object.keys(mathOps)])
      .sort()
  }, [])

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
        const description = opTypes[type]?.description || specialDescriptions[type]
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
