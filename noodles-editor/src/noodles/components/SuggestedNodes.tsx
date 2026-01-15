import type { NodeJSON } from 'SKIP-@xyflow/react'
import cx from 'classnames'
import { useMemo, useState } from 'react'

import type { IOperator, OpType, Operator } from '../operators'
import { type ConnectionPlan, findBestConnection } from '../utils/auto-connect'
import { type SuggestedNode, getSuggestedNodes } from '../utils/suggested-nodes'
import { getNodeDescription, headerClass, typeCategory, typeDisplayName } from './op-components'
import s from './node-properties.module.css'

interface SuggestedNodesSectionProps {
  operator: Operator<IOperator>
  node: NodeJSON<unknown>
  onAddNode: (opType: OpType, connection: ConnectionPlan) => void
}

export function SuggestedNodesSection({ operator, node, onAddNode }: SuggestedNodesSectionProps) {
  const [previewSuggestion, setPreviewSuggestion] = useState<SuggestedNode | null>(null)
  const [connectionPlan, setConnectionPlan] = useState<ConnectionPlan | null>(null)

  const suggestions = useMemo(() => getSuggestedNodes(operator, 6), [operator])

  const handleSuggestionClick = (suggestion: SuggestedNode) => {
    const plan = findBestConnection(operator, suggestion.opType)
    if (plan) {
      setPreviewSuggestion(suggestion)
      setConnectionPlan(plan)
    }
  }

  const handleConfirm = () => {
    if (previewSuggestion && connectionPlan) {
      onAddNode(previewSuggestion.opType, connectionPlan)
      setPreviewSuggestion(null)
      setConnectionPlan(null)
    }
  }

  const handleCancel = () => {
    setPreviewSuggestion(null)
    setConnectionPlan(null)
  }

  if (suggestions.length === 0) return null

  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>Suggested Nodes</div>
      <div className={s.suggestedNodesList}>
        {suggestions.map(suggestion => (
          <SuggestedNodeItem
            key={suggestion.opType}
            suggestion={suggestion}
            onClick={() => handleSuggestionClick(suggestion)}
          />
        ))}
      </div>

      {previewSuggestion && connectionPlan && (
        <SuggestionPreviewDialog
          sourceNode={node}
          suggestion={previewSuggestion}
          connectionPlan={connectionPlan}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
}

interface SuggestedNodeItemProps {
  suggestion: SuggestedNode
  onClick: () => void
}

function SuggestedNodeItem({ suggestion, onClick }: SuggestedNodeItemProps) {
  const displayName = typeDisplayName(suggestion.opType)
  const category = typeCategory(suggestion.opType)
  const description = getNodeDescription(suggestion.opType)

  return (
    <button type="button" className={s.suggestedNode} onClick={onClick}>
      <div className={s.suggestedNodeHeader}>
        <span className={s.suggestedNodeName}>{displayName}</span>
        <span className={cx(s.suggestedNodeCategory, headerClass(suggestion.opType))}>
          {category}
        </span>
      </div>
      {description && <div className={s.suggestedNodeDescription}>{description}</div>}
    </button>
  )
}

interface SuggestionPreviewDialogProps {
  sourceNode: NodeJSON<unknown>
  suggestion: SuggestedNode
  connectionPlan: ConnectionPlan
  onConfirm: () => void
  onCancel: () => void
}

function SuggestionPreviewDialog({
  sourceNode,
  suggestion,
  connectionPlan,
  onConfirm,
  onCancel,
}: SuggestionPreviewDialogProps) {
  const displayName = typeDisplayName(suggestion.opType)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Overlay click to close is standard modal UX
    <div className={s.suggestionPreviewOverlay} onClick={onCancel}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Prevent close when clicking card content */}
      <div className={s.suggestionPreviewCard} onClick={e => e.stopPropagation()}>
        <div className={s.suggestionPreviewTitle}>Add {displayName}?</div>
        <div className={s.suggestionPreviewConnection}>
          <span className={s.suggestionPreviewPath}>
            {sourceNode.id}.out.{connectionPlan.sourceOutput}
          </span>
          <span className={s.suggestionPreviewArrow}>→</span>
          <span className={s.suggestionPreviewPath}>par.{connectionPlan.targetInput}</span>
        </div>
        <div className={s.suggestionPreviewActions}>
          <button type="button" className={s.suggestionPreviewCancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={s.suggestionPreviewConfirm} onClick={onConfirm}>
            Add Node
          </button>
        </div>
      </div>
    </div>
  )
}
