import type { NoodlesProjectJSON } from '../utils/serialization'

// OrbitViewOp offered orbitAxis 'X', but deck.gl's OrbitView only supports 'Y' and 'Z'
// and drew 'X' exactly like 'Y'. 'X' is no longer a valid value, so saved 'X' becomes
// 'Y' to keep the same camera.

function migrateNode(node: NoodlesProjectJSON['nodes'][number]) {
  const inputs = node.data?.inputs
  if (node.type === 'OrbitViewOp' && inputs?.orbitAxis === 'X') {
    return { ...node, data: { ...node.data, inputs: { ...inputs, orbitAxis: 'Y' } } }
  }
  return node
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  let changed = false
  const nodes = project.nodes.map(node => {
    const migrated = migrateNode(node)
    if (migrated !== node) changed = true
    return migrated
  })
  return changed ? { ...project, nodes } : project
}

// 'Y' was always a valid value, so there is nothing to undo
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
