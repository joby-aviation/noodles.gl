import type { Field } from '../fields'
import { type IOperator, type OpType, type Operator, opTypes } from '../operators'
import { canConnect } from './can-connect'

export interface ConnectionPlan {
  sourceOutput: string
  targetInput: string
}

// Priority inputs - these are the most common primary data inputs
const PRIORITY_INPUTS = ['data', 'features', 'feature', 'layers', 'layer', 'views', 'view']

/**
 * Find the best output->input connection between a source operator and a target operator type.
 * Prefers connecting to primary inputs like 'data' or 'features'.
 * Returns null if no compatible connection exists.
 */
export function findBestConnection(
  sourceOp: Operator<IOperator>,
  targetOpType: OpType
): ConnectionPlan | null {
  const TargetOpClass = opTypes[targetOpType]
  if (!TargetOpClass) return null

  try {
    // Create temporary instance to inspect inputs
    const tempTarget = new TargetOpClass('/temp')
    const targetInputs = tempTarget.inputs as Record<string, Field>

    // First pass: try priority inputs
    for (const [outputName, outputField] of Object.entries(sourceOp.outputs)) {
      for (const inputName of PRIORITY_INPUTS) {
        const inputField = targetInputs[inputName]
        if (inputField && canConnect(outputField as Field, inputField)) {
          return { sourceOutput: outputName, targetInput: inputName }
        }
      }
    }

    // Second pass: any compatible pair
    for (const [outputName, outputField] of Object.entries(sourceOp.outputs)) {
      for (const [inputName, inputField] of Object.entries(targetInputs)) {
        if (canConnect(outputField as Field, inputField)) {
          return { sourceOutput: outputName, targetInput: inputName }
        }
      }
    }

    return null
  } catch {
    // Some operators may fail to instantiate without proper context
    return null
  }
}
