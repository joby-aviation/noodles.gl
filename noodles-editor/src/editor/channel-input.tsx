// A layer channel's value, marked by what it holds, so an attribute, a row expression and the
// layer's own default don't look alike: `▦ position` names an attribute of the layer's rows,
// `ƒ ramp(fit(mag, 0, 7, 0, 1))` computes one per row, and an empty channel falls back to the
// layer's style value. Plain parameter values keep the plain look.

import type { ParamDef } from '@noodles.gl/planner'
import cx from 'classnames'
import { useEffect, useId, useState } from 'react'
import s from './doc-editor.module.css'

export type ChannelKind = 'default' | 'attribute' | 'expression'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function channelKind(text: string): ChannelKind {
  const t = text.trim()
  if (t === '') return 'default'
  return IDENTIFIER.test(t) ? 'attribute' : 'expression'
}

// Channels are expression parameters that read the layer's input rows
export const isChannel = (def: ParamDef) => def.kind === 'expr' && def.of !== undefined

// What an empty channel uses, from its help ("Empty uses Fill color.")
export function channelDefault(def: ParamDef): string {
  const m = /Empty uses ([^.]+)\./.exec(def.help ?? '')
  return m ? `default · ${m[1]}` : 'default'
}

const BADGE: Record<ChannelKind, string> = { default: '', attribute: '▦', expression: 'ƒ' }
const TITLE: Record<ChannelKind, string> = {
  default: 'Empty: the layer uses its own value',
  attribute: 'An attribute of the layer’s rows',
  expression: 'A row expression, computed for each row',
}

export function ChannelInput({
  label,
  def,
  value,
  onCommit,
  suggestions,
  placeholder,
}: {
  label: string
  def: ParamDef
  value: string
  onCommit: (text: string) => void
  // Attribute names to offer while typing
  suggestions?: string[]
  placeholder?: string
}) {
  const listId = useId()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const kind = channelKind(draft)
  return (
    <div className={s.paramDriven}>
      <span className={s.paramLabel}>{label}</span>
      <span className={cx(s.channel, s[`channel_${kind}`])} title={TITLE[kind]}>
        {kind !== 'default' && <span className={s.channelBadge}>{BADGE[kind]}</span>}
        <input
          type="text"
          spellCheck={false}
          aria-label={label}
          value={draft}
          placeholder={placeholder ?? channelDefault(def)}
          list={suggestions?.length ? listId : undefined}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== value) onCommit(draft)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setDraft(value)
          }}
        />
        {suggestions && suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
        )}
      </span>
    </div>
  )
}
