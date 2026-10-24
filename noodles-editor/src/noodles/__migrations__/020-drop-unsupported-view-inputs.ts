import type { NoodlesProjectJSON } from '../utils/serialization'

// OrbitViewOp offered orbitAxis 'X', but deck.gl's OrbitView only supports 'Y' and 'Z'
// and drew 'X' exactly like 'Y'. 'X' is no longer a valid value, so saved 'X' becomes
// 'Y' to keep the same camera.
//
// Inputs deck.gl never read are removed, along with their saved values and incoming edges:
// - MapViewOp altitude: deck.gl derives altitude from fovy, which always has a value
// - ScaleWidgetOp label: deck.gl's _ScaleWidget draws only the distance

const REMOVED_INPUTS: Record<string, string[]> = {
  MapViewOp: ['altitude'],
  ScaleWidgetOp: ['label'],
}

type ProjectNode = NoodlesProjectJSON['nodes'][number]

function migrateNode(node: ProjectNode): ProjectNode {
  let inputs = node.data?.inputs
  if (!inputs) return node

  if (node.type === 'OrbitViewOp' && inputs.orbitAxis === 'X') {
    inputs = { ...inputs, orbitAxis: 'Y' }
  }
  for (const key of REMOVED_INPUTS[node.type ?? ''] ?? []) {
    if (key in inputs) {
      const { [key]: _removed, ...rest } = inputs
      inputs = rest
    }
  }
  return inputs === node.data.inputs ? node : { ...node, data: { ...node.data, inputs } }
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  let changed = false
  const nodes = project.nodes.map(node => {
    const migrated = migrateNode(node)
    if (migrated !== node) changed = true
    return migrated
  })

  const nodeTypes = new Map(project.nodes.map(node => [node.id, node.type ?? '']))
  const edges = project.edges.filter(edge => {
    const removed = REMOVED_INPUTS[nodeTypes.get(edge.target) ?? ''] ?? []
    return !removed.some(key => edge.targetHandle === `par.${key}`)
  })
  if (edges.length !== project.edges.length) changed = true

  return changed ? { ...project, nodes, edges } : project
}

// 'Y' was always a valid value and the removed inputs had no effect, so there is nothing
// to undo
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
