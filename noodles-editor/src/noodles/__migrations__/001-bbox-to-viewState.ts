import { renameHandle } from '../utils/migrate-schema'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Rename `bbox` to `viewState` in the project JSON for all edges that come from the `BoundingBoxOp` operator
// and have a `bbox` property
export async function up(project: NoodlesProjectJSON) {
  return renameHandle({
    type: 'BoundingBoxOp',
    inOut: 'out',
    oldHandle: 'bbox',
    newHandle: 'viewState',
    project,
  })
}

// Revert the migration by renaming `viewState` back to `bbox`
export async function down(project: NoodlesProjectJSON) {
  return renameHandle({
    type: 'BoundingBoxOp',
    inOut: 'out',
    oldHandle: 'viewState',
    newHandle: 'bbox',
    project,
  })
}
