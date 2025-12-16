import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename DateTimeOp's field from "date" to "datetime"
//
// This migration:
// 1. Renames the "date" field to "datetime" in DateTimeOp nodes
// 2. Updates edges that connect to the old field names
//
// Background: The old DateTimeOp used DateField with a field named "date".
// The new DateTimeOp uses TemporalField with a field named "datetime".
// Both store PlainDateTime serialized as ISO strings, so data is compatible.
//
// Note: Timeline keyframes reference the field by the operator path and field name,
// so timeline data needs to be updated as well.

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, edges, timeline, ...rest } = project

  // Step 1: Update node field names
  const newNodes = nodes.map(node => {
    if (node.type === 'DateTimeOp' && node.data.inputs.date !== undefined) {
      const { date, ...restInputs } = node.data.inputs
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...restInputs,
            datetime: date,
          },
        },
      }
    }
    return node
  })

  // Step 2: Update edges that connect to DateTimeOp's date field
  const newEdges = edges.map(edge => {
    const sourceNode = newNodes.find(n => n.id === edge.source)
    const targetNode = newNodes.find(n => n.id === edge.target)

    let newEdge = { ...edge }

    // Update source handle if it's from a DateTimeOp's date output
    if (sourceNode?.type === 'DateTimeOp' && edge.sourceHandle === 'out.date') {
      newEdge = {
        ...newEdge,
        sourceHandle: 'out.datetime',
        id: edge.id.replace('out.date', 'out.datetime'),
      }
    }

    // Update target handle if it's to a DateTimeOp's date input
    if (targetNode?.type === 'DateTimeOp' && edge.targetHandle === 'par.date') {
      newEdge = {
        ...newEdge,
        targetHandle: 'par.datetime',
        id: newEdge.id.replace('par.date', 'par.datetime'),
      }
    }

    return newEdge
  })

  // Step 3: Update timeline keyframes if they reference the old field name
  let newTimeline = timeline
  if (timeline?.sheetsById) {
    newTimeline = { ...timeline }
    Object.keys(timeline.sheetsById).forEach(sheetId => {
      const sheet = timeline.sheetsById[sheetId]
      if (sheet?.sequence?.tracksByObject) {
        const tracksByObject = { ...sheet.sequence.tracksByObject }

        Object.keys(tracksByObject).forEach(objectKey => {
          const node = newNodes.find(n => n.id === objectKey)
          if (node?.type === 'DateTimeOp' && tracksByObject[objectKey]?.trackData?.date) {
            const { date, ...restTrackData } = tracksByObject[objectKey].trackData
            tracksByObject[objectKey] = {
              ...tracksByObject[objectKey],
              trackData: {
                ...restTrackData,
                datetime: date,
              },
            }
          }
        })

        newTimeline = {
          ...newTimeline,
          sheetsById: {
            ...newTimeline.sheetsById,
            [sheetId]: {
              ...sheet,
              sequence: {
                ...sheet.sequence,
                tracksByObject,
              },
            },
          },
        }
      }
    })
  }

  return {
    ...rest,
    nodes: newNodes,
    edges: newEdges,
    timeline: newTimeline,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, edges, timeline, ...rest } = project

  // Step 1: Revert node field names
  const newNodes = nodes.map(node => {
    if (node.type === 'DateTimeOp' && node.data.inputs.datetime !== undefined) {
      const { datetime, ...restInputs } = node.data.inputs
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...restInputs,
            date: datetime,
          },
        },
      }
    }
    return node
  })

  // Step 2: Revert edges
  const newEdges = edges.map(edge => {
    const sourceNode = newNodes.find(n => n.id === edge.source)
    const targetNode = newNodes.find(n => n.id === edge.target)

    let newEdge = { ...edge }

    // Revert source handle
    if (sourceNode?.type === 'DateTimeOp' && edge.sourceHandle === 'out.datetime') {
      newEdge = {
        ...newEdge,
        sourceHandle: 'out.date',
        id: edge.id.replace('out.datetime', 'out.date'),
      }
    }

    // Revert target handle
    if (targetNode?.type === 'DateTimeOp' && edge.targetHandle === 'par.datetime') {
      newEdge = {
        ...newEdge,
        targetHandle: 'par.date',
        id: newEdge.id.replace('par.datetime', 'par.date'),
      }
    }

    return newEdge
  })

  // Step 3: Revert timeline keyframes
  let newTimeline = timeline
  if (timeline?.sheetsById) {
    newTimeline = { ...timeline }
    Object.keys(timeline.sheetsById).forEach(sheetId => {
      const sheet = timeline.sheetsById[sheetId]
      if (sheet?.sequence?.tracksByObject) {
        const tracksByObject = { ...sheet.sequence.tracksByObject }

        Object.keys(tracksByObject).forEach(objectKey => {
          const node = newNodes.find(n => n.id === objectKey)
          if (node?.type === 'DateTimeOp' && tracksByObject[objectKey]?.trackData?.datetime) {
            const { datetime, ...restTrackData } = tracksByObject[objectKey].trackData
            tracksByObject[objectKey] = {
              ...tracksByObject[objectKey],
              trackData: {
                ...restTrackData,
                date: datetime,
              },
            }
          }
        })

        newTimeline = {
          ...newTimeline,
          sheetsById: {
            ...newTimeline.sheetsById,
            [sheetId]: {
              ...sheet,
              sequence: {
                ...sheet.sequence,
                tracksByObject,
              },
            },
          },
        }
      }
    })
  }

  return {
    ...rest,
    nodes: newNodes,
    edges: newEdges,
    timeline: newTimeline,
  }
}
