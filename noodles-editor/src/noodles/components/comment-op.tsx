import { NodeResizer, type NodeProps as ReactFlowNodeProps } from '@xyflow/react'
import cx from 'classnames'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import nodeStyles from '../noodles.module.css'
import type { CommentOp } from '../operators'
import { getOp } from '../store'
import type { NodeDataJSON } from '../transform-graph'
import { FieldEditScope } from '../utils/field-edit-analytics'
import { usePropertyHistory } from '../utils/property-history'
import s from './comment-op.module.css'
import { useLocked } from './op-components'

export const COMMENT_MIN_WIDTH = 120
export const COMMENT_MIN_HEIGHT = 40

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

// Plain text with bare http(s) URLs turned into links. Line breaks are kept by CSS.
export function linkifyText(text: string): ReactNode[] {
  return text.split(URL_PATTERN).map((part, i) =>
    // split() with a capture group puts the matches at odd indexes
    i % 2 === 1 ? (
      <a
        // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
        key={i}
        className={cx(s.commentLink, 'nodrag')}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        onDoubleClick={e => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      part
    )
  )
}

function CommentEditor({
  field,
  onDone,
}: {
  field: CommentOp['inputs']['text']
  onDone: () => void
}) {
  const [draft, setDraft] = useState(field.value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { captureStart, commitChange } = usePropertyHistory()

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  return (
    <textarea
      ref={textareaRef}
      className={cx(s.commentTextarea, 'nodrag', 'nowheel', 'nokey')}
      aria-label="Comment text"
      value={draft}
      placeholder="Write a note"
      onFocus={captureStart}
      onChange={e => setDraft(e.currentTarget.value)}
      onBlur={() => {
        if (draft !== field.value) field.setValue(draft)
        commitChange('Edit comment')
        onDone()
      }}
      onKeyDown={e => {
        // Keep editor shortcuts (delete node, undo) away from the text
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function CommentOpComponent({
  id,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<CommentOp>> & { type: 'CommentOp' }) {
  const op = getOp(id as string) as CommentOp | undefined
  const locked = useLocked(op)
  const [text, setText] = useState(op?.inputs.text.value ?? '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!op) return
    const sub = op.inputs.text.subscribe(setText)
    return () => sub.unsubscribe()
  }, [op])

  if (!op) return null

  return (
    <div
      role="note"
      className={cx(s.comment, {
        [nodeStyles.dragHandle]: !editing,
        [s.commentSelected]: selected,
      })}
      onDoubleClick={e => {
        if (locked) return
        e.stopPropagation()
        setEditing(true)
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={COMMENT_MIN_WIDTH}
        minHeight={COMMENT_MIN_HEIGHT}
      />
      {editing ? (
        <FieldEditScope field={op.inputs.text}>
          <CommentEditor field={op.inputs.text} onDone={() => setEditing(false)} />
        </FieldEditScope>
      ) : (
        <div className={cx(s.commentText, { [s.commentEmpty]: text === '' })}>
          {text === '' ? 'Double-click to write a note' : linkifyText(text)}
        </div>
      )}
    </div>
  )
}
