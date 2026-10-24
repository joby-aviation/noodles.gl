// A comment in the network: a note explaining the nodes beside it. Its text and size are its
// parameters, so editing and resizing it are document edits that undo and save like any other.

import { type NodeProps, NodeResizer } from '@xyflow/react'
import cx from 'classnames'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import s from '../noodles/components/comment-op.module.css'
import { setParam } from './doc-ops'
import { docStore, useEditor } from './doc-store'

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

function CommentEditor({ id, text, onDone }: { id: string; text: string; onDone: () => void }) {
  const [draft, setDraft] = useState(text)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  return (
    <textarea
      ref={ref}
      className={cx(s.commentTextarea, 'nodrag', 'nowheel', 'nokey')}
      aria-label="Comment text"
      value={draft}
      placeholder="Write a note"
      onChange={e => setDraft(e.currentTarget.value)}
      onBlur={() => {
        // One undo step for the whole edit
        if (draft !== text) docStore().edit(d => setParam(d, id, 'text', draft))
        onDone()
      }}
      onKeyDown={e => {
        // Keep the network's shortcuts (delete node, undo) away from the text
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function DocCommentComponent({ id, selected }: NodeProps) {
  const node = useEditor(st => st.doc.nodes.find(n => n.id === id))
  const [editing, setEditing] = useState(false)
  if (!node) return null
  const text = typeof node.params.text === 'string' ? node.params.text : ''
  return (
    <div
      role="note"
      className={cx(s.comment, { [s.commentSelected]: selected })}
      style={{ width: '100%', height: '100%' }}
      onDoubleClick={e => {
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
        <CommentEditor id={id} text={text} onDone={() => setEditing(false)} />
      ) : (
        <div className={cx(s.commentText, { [s.commentEmpty]: text === '' })}>
          {text === '' ? 'Double-click to write a note' : linkifyText(text)}
        </div>
      )}
    </div>
  )
}
