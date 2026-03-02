import type { NodeJSON } from 'SKIP-@xyflow/react'
import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useMemo, useState } from 'react'

import type { IOperator, OpType, Operator } from '../operators'
import { type ConnectionPlan, findBestConnection } from '../utils/auto-connect'
import { type SuggestedNode, getSuggestedNodes } from '../utils/suggested-nodes'
import menuStyles from './menu.module.css'
import s from './node-properties.module.css'
import { getNodeDescription, headerClass, typeCategory, typeDisplayName } from './op-components'

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

  const handleClose = () => {
    setPreviewSuggestion(null)
    setConnectionPlan(null)
  }

  if (suggestions.length === 0) return null

  const isDialogOpen = previewSuggestion !== null && connectionPlan !== null

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

      <Dialog.Root open={isDialogOpen} onOpenChange={open => !open && handleClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            {previewSuggestion && connectionPlan && (
              <SuggestionPreviewContent
                sourceNodeId={node.id}
                suggestion={previewSuggestion}
                connectionPlan={connectionPlan}
                onConfirm={handleConfirm}
              />
            )}
            <Dialog.Close asChild>
              <button type="button" className={menuStyles.dialogIconButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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

interface SuggestionPreviewContentProps {
  sourceNodeId: string
  suggestion: SuggestedNode
  connectionPlan: ConnectionPlan
  onConfirm: () => void
}

function SuggestionPreviewContent({
  sourceNodeId,
  suggestion,
  connectionPlan,
  onConfirm,
}: SuggestionPreviewContentProps) {
  const displayName = typeDisplayName(suggestion.opType)

  return (
    <>
      <Dialog.Title className={menuStyles.dialogTitle}>Add {displayName}?</Dialog.Title>
      <Dialog.Description className={menuStyles.dialogDescription}>
        This will create a new {displayName} node and connect it to the selected node.
      </Dialog.Description>
      <div className={s.suggestionPreviewConnection}>
        <span className={s.suggestionPreviewPath}>
          {sourceNodeId}.out.{connectionPlan.sourceOutput}
        </span>
        <span className={s.suggestionPreviewArrow}>→</span>
        <span className={s.suggestionPreviewPath}>par.{connectionPlan.targetInput}</span>
      </div>
      <div className={menuStyles.dialogRightSlot}>
        <Dialog.Close asChild>
          <button type="button" className={cx(menuStyles.dialogButton, menuStyles.violet)}>
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="button"
          className={cx(menuStyles.dialogButton, menuStyles.green)}
          onClick={onConfirm}
        >
          Add Node
        </button>
      </div>
    </>
  )
}
