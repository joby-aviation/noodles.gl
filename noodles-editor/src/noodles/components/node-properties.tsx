import type { NodeJSON } from 'SKIP-@xyflow/react'
import type { Edge } from '@xyflow/react'
import { useEdges, useNodes, useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { useEffect, useRef, useState } from 'react'

import { IN_NS, ListField, OUT_NS } from '../fields'
import { useSlice } from '../store'
import s from './node-properties.module.css'
import { handleClass, headerClass, typeCategory } from './op-components'

function copy(text: string) {
  navigator.clipboard.writeText(text)
}

function ReferenceIcon({
  codeReference,
  altReference,
}: {
  codeReference: string
  altReference: string
}) {
  const [isShiftHeld, setIsShiftHeld] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isHovering) {
        setIsShiftHeld(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftHeld(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isHovering])

  return (
    <Tooltip text={isShiftHeld ? 'Copy Mustache Format' : 'Copy Code Format'} position="left">
      <svg
        className={s.referenceIcon}
        role="img"
        onClick={e => {
          const reference = e.shiftKey ? altReference : codeReference
          copy(reference)
        }}
        onMouseEnter={e => {
          setIsHovering(true)
          setIsShiftHeld(e.shiftKey)
        }}
        onMouseLeave={() => {
          setIsHovering(false)
          setIsShiftHeld(false)
        }}
        viewBox="0 -960 960 960"
      >
        <path d="M360-240q-29.7 0-50.85-21.15Q288-282.3 288-312v-480q0-29.7 21.15-50.85Q330.3-864 360-864h384q29.7 0 50.85 21.15Q816-821.7 816-792v480q0 29.7-21.15 50.85Q773.7-240 744-240H360Zm0-72h384v-480H360v480ZM216-96q-29.7 0-50.85-21.15Q144-138.3 144-168v-552h72v552h456v72H216Zm144-216v-480 480Z" />
      </svg>
    </Tooltip>
  )
}

function InfoIcon({ description }: { description: string }) {
  return (
    <Tooltip text={description}>
      <svg role="img" viewBox="0 -960 960 960" className={s.tooltipIcon}>
        <path d="M444-288h72v-240h-72v240Zm35.79-312q15.21 0 25.71-10.29t10.5-25.5q0-15.21-10.29-25.71t-25.5-10.5q-15.21 0-25.71 10.29t-10.5 25.5q0 15.21 10.29 25.71t25.5 10.5Zm.49 504Q401-96 331-126t-122.5-82.5Q156-261 126-330.96t-30-149.5Q96-560 126-629.5q30-69.5 82.5-122T330.96-834q69.96-30 149.5-30t149.04 30q69.5 30 122 82.5T834-629.28q30 69.73 30 149Q864-401 834-331t-82.5 122.5Q699-156 629.28-126q-69.73 30-149 30Zm-.28-72q130 0 221-91t91-221q0-130-91-221t-221-91q-130 0-221 91t-91 221q0 130 91 221t221 91Zm0-312Z" />
      </svg>
    </Tooltip>
  )
}

function Tooltip({
  text,
  position = 'top',
  children,
}: {
  text: string
  position?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactNode
}) {
  return (
    <div className={s.tooltipContainer}>
      {children}
      <span className={cx(s.tooltipText, s[position])}>{text}</span>
    </div>
  )
}

function NodeProperties({ node }: { node: NodeJSON<unknown> }) {
  const ops = useSlice(state => state.ops)
  const { setEdges } = useReactFlow()
  const edges = useEdges()
  const dragDataRef = useRef<{ inputName: string; index: number } | null>(null)
  const draggingRef = useRef<HTMLElement | null>(null)
  const op = ops.get(node.id)
  if (!op) return null
  const { name, displayName, description } = op.constructor

  const inputs = Object.entries(op.inputs).map(([name, input]) => ({
    name,
    type: input.constructor.type,
    codeRef: `op('${op.id}').${IN_NS}.${name}`,
    mustacheRef: `{{${op.id}.${IN_NS}.${name}}}`,
    handleClass: handleClass(input),
    field: input,
  }))

  const outputs = Object.entries(op.outputs).map(([name, output]) => ({
    name,
    type: output.constructor.type,
    codeRef: `op('${op.id}').${OUT_NS}.${name}`,
    mustacheRef: `{{${op.id}.${OUT_NS}.${name}}}`,
    handleClass: handleClass(output),
    field: output,
  }))

  const handleMoveConnection = (inputName: string, fromIndex: number, toIndex: number) => {
    const input = op.inputs[inputName]
    if (!(input instanceof ListField)) return

    setEdges(edges => {
      // Get all edges connected to this input
      const relevantEdges = edges.filter(e => e.target === node.id && e.targetHandle === inputName)
      if (relevantEdges.length < 2) return edges

      // Create new array with reordered edges
      const newEdges = [...edges]
      const edgeIndexMap = new Map(
        relevantEdges.map((e, _i) => [e.id, edges.findIndex(edge => edge.id === e.id)])
      )
      const [movedEdge] = newEdges.splice(edgeIndexMap.get(relevantEdges[fromIndex].id)!, 1)
      const targetIndex = edgeIndexMap.get(relevantEdges[toIndex].id)!
      newEdges.splice(targetIndex, 0, movedEdge)

      // Update the ListField's internal order
      input.reorderInputs(fromIndex, toIndex)

      return newEdges
    })
  }

  const handleDragStart = (e: React.DragEvent, inputName: string, index: number) => {
    dragDataRef.current = { inputName, index }
    draggingRef.current = e.currentTarget as HTMLElement
    e.currentTarget.classList.add('dragging')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    const draggingEl = draggingRef.current
    if (!draggingEl) return

    const container = e.currentTarget as HTMLElement
    const siblings = Array.from(container.children).filter(
      child => child !== draggingEl && child.classList.contains(s.connection)
    )

    const nextSibling = siblings.find(sibling => {
      const rect = sibling.getBoundingClientRect()
      const offset = e.clientY - rect.top - rect.height / 2
      return offset < 0
    })

    if (nextSibling) {
      container.insertBefore(draggingEl, nextSibling)
    } else {
      container.appendChild(draggingEl)
    }
  }

  const handleDragEnd = (e: React.DragEvent, inputName: string, _incomers: Edge[]) => {
    e.currentTarget.classList.remove('dragging')
    const container = e.currentTarget.parentElement
    if (!container) return

    const dragData = dragDataRef.current
    if (!dragData || dragData.inputName !== inputName) return

    const newIndex = Array.from(container.children).indexOf(e.currentTarget)
    const oldIndex = dragData.index

    if (oldIndex !== newIndex) {
      handleMoveConnection(inputName, oldIndex, newIndex)
    }

    dragDataRef.current = null
    draggingRef.current = null
  }

  return (
    <>
      <div className={s.header}>
        <div className={s.title}>
          {displayName}
          {description && <InfoIcon description={description} />}
          <div className={cx(s.capsule, headerClass(name))}>{typeCategory(name)}</div>
        </div>
      </div>
      <div className={s.section}>
        <label className={s.input}>
          <span>ID</span>
          <input type="text" value={op.id} readOnly />
        </label>
      </div>
      <div className={s.section}>
        <div className={s.sectionTitle}>Position</div>
        <div className={s.position}>
          <label className={s.input}>
            <span>X</span>
            <input type="text" value={Math.round(node.position.x)} readOnly />
          </label>
          <label className={s.input}>
            <span>Y</span>
            <input type="text" value={Math.round(node.position.y)} readOnly />
          </label>
        </div>
      </div>
      <div className={s.section}>
        <div className={s.sectionTitle}>Inputs</div>
        <div className={s.propertyList}>
          {inputs.map(input => {
            const incomers = edges.filter(
              e => e.target === node.id && e.targetHandle === input.name
            )
            return (
              <div key={input.name} className={s.property} title={input.codeRef}>
                <div className={s.propertyHeader}>
                  <div>{input.name}</div>
                  <div className={s.propertyDetails}>
                    <div>{input.type}</div>
                    <div className={cx(s.port, input.handleClass)} />
                    <ReferenceIcon codeReference={input.codeRef} altReference={input.mustacheRef} />
                  </div>
                </div>
                {input.field instanceof ListField && incomers.length > 0 && (
                  <div className={s.connections} role="list" onDragOver={handleDragOver}>
                    {incomers.map((edge, index) => (
                      <div
                        key={edge.id}
                        className={s.connection}
                        role="listitem"
                        tabIndex={incomers.length > 1 ? 0 : -1}
                        draggable={incomers.length > 1}
                        onDragStart={e => handleDragStart(e, input.name, index)}
                        onDragEnd={e => handleDragEnd(e, input.name, incomers)}
                      >
                        {incomers.length > 1 && <div className={s.dragHandle} />}
                        <div className={s.connectionSource}>{edge.sourceHandle}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className={s.section}>
        <div className={s.sectionTitle}>Outputs</div>
        <div className={s.propertyList}>
          {outputs.map(output => (
            <div key={output.name} className={s.property} title={output.codeRef}>
              <div className={s.propertyHeader}>
                <div>{output.name}</div>
                <div className={s.propertyDetails}>
                  <div>{output.type}</div>
                  <div className={cx(s.port, output.handleClass)} />
                  <ReferenceIcon codeReference={output.codeRef} altReference={output.mustacheRef} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function PropertyPanel() {
  const nodes = useNodes()
  const edges = useEdges()
  const selectedNodes = nodes.filter(n => n.selected)
  const selectedEdges = edges.filter(n => n.selected)

  return (
    <div className={s.panel}>
      {selectedNodes.length === 1 ? (
        <NodeProperties node={selectedNodes[0]} />
      ) : (
        <>
          <div className={s.header}>
            <div className={s.title}>Page</div>
          </div>
          {selectedNodes.length > 1 ? (
            <div>
              <div>{selectedNodes.length} nodes selected</div>
              <div>{selectedEdges.length} edges selected</div>
            </div>
          ) : (
            <div>Select a node to see properties</div>
          )}
        </>
      )}
    </div>
  )
}
