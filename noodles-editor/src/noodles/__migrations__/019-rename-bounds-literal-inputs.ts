import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration 017 renamed BoundsOp point1 -> southwest and point2 -> northeast, but only
// when an edge targeted the old handle. BoundsOps with literal point values and no
// incoming edge kept data.inputs.point1/point2, which the operator no longer reads.
// This renames those leftover input keys. Edges were already handled by 017.

const RENAMES: [oldKey: string, newKey: string][] = [
  ['point1', 'southwest'],
  ['point2', 'northeast'],
]

function renameBoundsInputs(
  project: NoodlesProjectJSON,
  renames: [from: string, to: string][]
): NoodlesProjectJSON {
  let changed = false
  const nodes = project.nodes.map(node => {
    const inputs = node.data?.inputs
    if (node.type !== 'BoundsOp' || !inputs) return node

    let newInputs = inputs
    for (const [from, to] of renames) {
      if (from in newInputs && !(to in newInputs)) {
        const { [from]: value, ...rest } = newInputs
        newInputs = { ...rest, [to]: value }
      }
    }
    if (newInputs === inputs) return node

    changed = true
    return { ...node, data: { ...node.data, inputs: newInputs } }
  })

  return changed ? { ...project, nodes } : project
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return renameBoundsInputs(project, RENAMES)
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return renameBoundsInputs(
    project,
    RENAMES.map(([oldKey, newKey]) => [newKey, oldKey])
  )
}
