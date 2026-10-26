import type { NodeProps as ReactFlowNodeProps } from '@xyflow/react'
import cx from 'classnames'

import type { Field, IField } from '../fields'
import s from '../noodles.module.css'
import type { IOperator, Operator } from '../operators'
import { getOp } from '../store'
import { FieldComponent } from './field-components'
import {
  NodeHeader,
  OutputHandle,
  PAR_HANDLE_OPTIONS,
  useFieldVisibility,
  useLocked,
  useNodeDimmed,
} from './op-components'
import { EditOnMapButton } from './tools/edit-on-map-button'

export function GeoEditorOpComponent(props: ReactFlowNodeProps) {
  const op = getOp(props.id as string)
  if (!op) return null
  return <GeoEditorOpInner {...props} op={op} />
}

function GeoEditorOpInner({ id, type, op }: ReactFlowNodeProps & { op: Operator<IOperator> }) {
  const isDimmed = useNodeDimmed(id)
  const locked = useLocked(op)
  useFieldVisibility(op)

  return (
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
      <NodeHeader id={id} type={type} op={op} />
      <div className={s.content}>
        <FieldComponent
          id="geojson"
          field={op.inputs.geojson as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        {!locked && <EditOnMapButton nodeId={id} from="node" className="nodrag" />}
        <div className={s.outputHandleContainer}>
          <OutputHandle
            id="featureCollection"
            field={op.outputs.featureCollection as Field<IField>}
          />
        </div>
      </div>
    </div>
  )
}
