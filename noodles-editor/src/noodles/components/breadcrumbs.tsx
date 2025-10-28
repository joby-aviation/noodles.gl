import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useKeyPress, useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { type FC, Fragment, useCallback, useEffect } from 'react'
import { ContainerOp } from '../operators'
import { opMap, useSlice } from '../store' // To access opMap for node names
import { getBaseName, getParentPath, joinPath, splitPath } from '../utils/path-utils'
import s from './breadcrumbs.module.css'

export const Breadcrumbs: FC = () => {
  const { currentContainerId, setCurrentContainerId } = useSlice(state => state.nesting)
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

  const getMenuItems = (containerId: string) => {
    return Array.from(opMap)
      .filter(
        ([key, op]) =>
          key !== containerId && getParentPath(key) === containerId && op instanceof ContainerOp
      )
      .map(([key]) => key)
  }

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
