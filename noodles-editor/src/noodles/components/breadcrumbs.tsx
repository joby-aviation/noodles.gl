import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useKeyPress, useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { type FC, Fragment, useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ContainerOp } from '../operators'
import { useNestingStore, useOperatorStore } from '../store'
import { getBaseName, getParentPath, joinPath, splitPath } from '../utils/path-utils'
import s from './breadcrumbs.module.css'

export const Breadcrumbs: FC = () => {
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const setCurrentContainerId = useNestingStore(state => state.setCurrentContainerId)
  const reactFlow = useReactFlow()
  const uPressed = useKeyPress('u', { target: document.body })

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
    const lastSegment = pathSegments[pathSegments.length - 2]
    if (lastSegment) {
      setCurrentContainerId(lastSegment.id)
    }
  }, [pathSegments, setCurrentContainerId])

  useEffect(() => {
    if (uPressed && pathSegments.length > 1) {
      goUp()
    }
  }, [uPressed, goUp, pathSegments.length])

  return (
    <div className={s.bar}>
      {pathSegments.map(segment => (
        <Fragment key={segment.id}>
          <button
            type="button"
            className={cx(s.segment, segment.id === currentContainerId && s.active)}
            onClick={() => setCurrentContainerId(segment.id)}
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
                  onClick={() => setCurrentContainerId(item)}
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
