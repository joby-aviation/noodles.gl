import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useKeyPress, useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { type FC, Fragment, useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { analytics } from '../../utils/analytics'
import { ContainerOp } from '../operators'
import { getOpStore, useNestingStore, useOperatorStore } from '../store'
import { getBaseName, getParentPath, joinPath, splitPath } from '../utils/path-utils'
import s from './breadcrumbs.module.css'

export const Breadcrumbs: FC = () => {
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const setCurrentContainerId = useNestingStore(state => state.setCurrentContainerId)
  const reactFlow = useReactFlow()
  const uPressed = useKeyPress('u', { target: document.body })
  const dPressed = useKeyPress('d', { target: document.body })

  const pathSegments = splitPath(currentContainerId).reduce<{ name: string; id: string }[]>(
    (acc, segment) => {
      acc.push({
        name: segment === '/' || segment === '' ? 'root' : segment,
        id: joinPath(...acc.map(s => s.id), segment),
      })
      return acc
    },
    []
  )

  // Reactively subscribe to operator changes to keep breadcrumb dropdowns in sync
  // This ensures dropdowns update when containers are added/removed
  const allContainerOps = useOperatorStore(
    useShallow(state =>
      Array.from(state.operators.entries())
        .filter(([_key, op]) => op instanceof ContainerOp)
        .map(([key]) => key)
    )
  )

  // Filter containers by parent path for each dropdown
  const getMenuItems = useCallback(
    (containerId: string) => {
      return allContainerOps.filter(
        key => key !== containerId && getParentPath(key) === containerId
      )
    },
    [allContainerOps]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: We fit the view when the current container changes
  useEffect(() => {
    reactFlow.fitView()
  }, [reactFlow.fitView, currentContainerId])

  const goUp = useCallback(() => {
    const parentPath = getParentPath(currentContainerId)
    if (parentPath && parentPath !== currentContainerId) {
      // Clear selection when changing levels
      reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
      setCurrentContainerId(parentPath)

      // Fit all nodes at the new level (no animation)
      setTimeout(() => {
        reactFlow.fitView({ duration: 0 })
      }, 50)
    }
  }, [currentContainerId, setCurrentContainerId, reactFlow])

  const uPressHandledRef = useRef(false)

  useEffect(() => {
    if (!uPressed) {
      // Reset the flag when key is released
      uPressHandledRef.current = false
      return
    }

    // Only handle once per key press
    if (uPressHandledRef.current) return
    uPressHandledRef.current = true

    if (pathSegments.length > 1) {
      goUp()
    }
  }, [uPressed, goUp, pathSegments.length])

  const dPressHandledRef = useRef(false)

  // Handle 'd' key press to navigate down into selected container
  useEffect(() => {
    if (!dPressed) {
      dPressHandledRef.current = false
      return
    }
    if (dPressHandledRef.current) return
    dPressHandledRef.current = true

    const nodes = reactFlow.getNodes()
    const selectedNode = nodes.find(n => n.selected)
    if (!selectedNode) return

    const store = getOpStore()
    const op = store.getOp(selectedNode.id)
    if (op instanceof ContainerOp) {
      const nodeParent = getParentPath(selectedNode.id)
      if (nodeParent === currentContainerId) {
        reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
        setCurrentContainerId(selectedNode.id)
        analytics.track('container_navigated', { method: 'keyboard', direction: 'down' })
        setTimeout(() => {
          reactFlow.fitView({ duration: 0 })
        }, 50)
      }
    }
  }, [dPressed, currentContainerId, reactFlow, setCurrentContainerId])

  const handleBreadcrumbClick = useCallback(
    (segmentId: string) => {
      reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
      setCurrentContainerId(segmentId)
      setTimeout(() => {
        reactFlow.fitView({ duration: 0 })
      }, 50)
    },
    [reactFlow, setCurrentContainerId]
  )

  const handleMenuItemClick = useCallback(
    (itemId: string) => {
      reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
      setCurrentContainerId(itemId)
      setTimeout(() => {
        reactFlow.fitView({ duration: 0 })
      }, 50)
    },
    [reactFlow, setCurrentContainerId]
  )

  return (
    <div className={s.bar}>
      {pathSegments.map(segment => (
        <Fragment key={segment.id}>
          <button
            type="button"
            className={cx(s.segment, segment.id === currentContainerId && s.active)}
            onClick={() => handleBreadcrumbClick(segment.id)}
          >
            {segment.name}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <span className={s.separator}> / </span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className={s.menu} align="start">
              {getMenuItems(segment.id).map(item => (
                <DropdownMenu.Item
                  key={item}
                  className={s.menuItem}
                  onClick={() => handleMenuItemClick(item)}
                >
                  {getBaseName(item)}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Fragment>
      ))}
    </div>
  )
}
