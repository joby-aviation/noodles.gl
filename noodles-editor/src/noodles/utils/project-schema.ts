// The shape of a noodles.json file, published as JSON Schemas (see
// scripts/generate-project-schema.ts):
//
// - https://noodles.gl/schema/noodles-project.schema.json: a document, the format the editor
//   saves (EditorDoc in packages/planner/src/doc.ts), with a pinned copy per document
//   version at noodles-document.v<N>.schema.json
// - noodles-project.v<N>.schema.json: an older operator-graph project (schema 1 to 19),
//   which the editor converts to a document when it opens one
//
// Both cover file shape only. Whether a node's operator is real, and whether its parameters
// and ports exist, is checked by noodles-validate against the operator registry.
//
// No runtime imports besides zod, so the generator script can load this file in plain Node.

import { z } from 'zod'

export const SCHEMA_BASE_URL = 'https://noodles.gl/schema'

// The document format's version: EditorDoc's `version`
export const DOCUMENT_VERSION = 1

export const schemaFileName = (version?: number) =>
  version === undefined ? 'noodles-project.schema.json' : `noodles-project.v${version}.schema.json`

export const documentSchemaFileName = (version: number) =>
  `noodles-document.v${version}.schema.json`

// Same rule as noodles-validate: /name, or /container/name inside a container
const nodePath = z
  .string()
  .regex(/^(\/[^/\s]+)+$/)
  .describe('Absolute operator path, e.g. /earthquake-data or /container/child')

const handle = z
  .string()
  .regex(/^(out|par)\./)
  .describe('Field handle: out.<field> for an output, par.<field> for an input')

// ============================================================================
// Operator-graph projects (schema 1 to 19)
// ============================================================================

// Objects accept keys they don't list: React Flow added its own node and edge props, and
// older files carry settings the editor no longer reads.

const customInput = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string().describe('Field type, e.g. number or string'),
  order: z.number(),
  options: z.record(z.string(), z.unknown()).optional(),
  defaultValue: z.unknown().optional(),
  enableExpression: z.string().optional(),
})

const nodeData = z.looseObject({
  inputs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Input values that differ from the defaults, by field name'),
  locked: z.boolean().optional(),
  customInputs: z.array(customInput).optional(),
  visibleInputs: z.array(z.string()).optional(),
  ui: z.looseObject({ numberSteps: z.record(z.string(), z.number()).optional() }).optional(),
})

const node = z.looseObject({
  id: nodePath,
  type: z.string().min(1).describe('Operator type, e.g. FileOp, or group'),
  position: z.strictObject({ x: z.number(), y: z.number() }),
  data: nodeData.optional(),
  parentId: nodePath.optional(),
})

const edge = z.looseObject({
  id: z
    .string()
    .describe(
      'By convention <source>.<sourceHandle>-><target>.<targetHandle>, e.g. /a.out.data->/b.par.data'
    ),
  source: nodePath,
  target: nodePath,
  sourceHandle: handle.nullable(),
  targetHandle: handle,
  type: z.string().optional(),
})

// ============================================================================
// Timeline (serialized form of src/timeline/types.ts TimelineData)
// ============================================================================

// Any JSON value. Table cell objects are keyframed as they are, so they can hold arrays and nulls
const jsonValue: z.ZodType<unknown> = z
  .union([
    z.number(),
    z.boolean(),
    z.string(),
    z.null(),
    z.array(z.lazy(() => jsonValue)),
    z.record(
      z.string(),
      z.lazy(() => jsonValue)
    ),
  ])
  .meta({ id: 'JsonValue' })

// A number, boolean or string, or an object such as { r, g, b, a } or { lng, lat }. Arrays come
// from tools that keyframe a raw tuple.
const keyframeValue = z
  .union([z.number(), z.boolean(), z.string(), z.array(jsonValue), z.record(z.string(), jsonValue)])
  .meta({ id: 'KeyframeValue' })

const unit = z.number().min(0).max(1)

const keyframe = z.looseObject({
  id: z.string(),
  position: z.number().min(0).describe('Time in seconds'),
  connectedRight: z
    .boolean()
    .describe('true eases to the next keyframe; false holds this value until the next one'),
  handles: z
    .tuple([unit, z.number(), unit, z.number()])
    // zod leaves the length out of the JSON Schema for a tuple
    .meta({
      description: 'Bezier handles [leftX, leftY, rightX, rightY], x in 0 to 1',
      minItems: 4,
      maxItems: 4,
    }),
  type: z.string().optional(),
  value: keyframeValue,
})

const track = z.looseObject({
  type: z.string().describe('The editor writes BasicKeyframedTrack'),
  __debugName: z.string().optional(),
  keyframes: z
    .array(keyframe)
    .refine(
      keyframes => keyframes.every((kf, i) => i === 0 || keyframes[i - 1].position <= kf.position),
      'Keyframes are sorted by position'
    )
    .describe('Sorted by position'),
})

const marker = z.looseObject({
  id: z.string(),
  position: z.number().min(0),
  connections: z.array(
    z.looseObject({
      keyframeId: z.string(),
      trackPath: z
        .string()
        .describe('Track field path, e.g. "maplibre-basemap / viewState / zoom"'),
      offset: z.number(),
    })
  ),
})

const sequence = z.looseObject({
  length: z.number().positive().describe('Duration in seconds'),
  subUnitsPerUnit: z.number().positive().describe('Frames per second'),
  tracksByObject: z
    .record(
      z.string().describe('Node id without the leading slash'),
      z.looseObject({
        trackIdByPropPath: z
          .record(z.string(), z.string())
          .describe(
            'Field path (e.g. viewState.zoom, or a JSON array of parts) to a trackData key'
          ),
        trackData: z.record(z.string(), track),
      })
    )
    .describe('Animated fields, by node'),
  markers: z.array(marker).optional(),
  inPoint: z.number().min(0).optional().describe('Render start in seconds'),
  outPoint: z.number().min(0).optional().describe('Render end in seconds'),
})

const timelineSchema = z.looseObject({
  sheetsById: z
    .looseObject({
      Noodles: z.looseObject({
        sequence: sequence.optional().describe('Omitted when nothing is animated'),
        staticOverrides: z.looseObject({ byObject: z.record(z.string(), z.unknown()) }).optional(),
      }),
    })
    .optional(),
  definitionVersion: z.string().optional(),
  revisionHistory: z.array(z.unknown()).optional(),
})

// ============================================================================
// Project
// ============================================================================

export function projectSchema(version: number) {
  return z.looseObject({
    $schema: z.string().optional(),
    version: z
      .literal(version)
      .describe('Schema version. Older files are migrated when the editor opens them'),
    name: z.string().optional(),
    nodes: z.array(node),
    edges: z.array(edge),
    viewport: z.strictObject({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
    timeline: timelineSchema.optional(),
    editorSettings: z
      .looseObject({
        showOverlay: z.boolean().optional(),
        showDebugInfo: z.boolean().optional(),
        autoLayout: z.looseObject({ enabled: z.boolean().optional() }).optional(),
        startNode: nodePath.optional().describe('Examples only: node selected when it opens'),
      })
      .optional(),
    apiKeys: z
      .looseObject({
        mapbox: z.string().optional(),
        googleMaps: z.string().optional(),
        cesium: z.string().optional(),
        overpass: z.string().optional(),
      })
      .optional()
      .describe('Map service keys saved with the project. AI keys are never read from a file'),
  })
}

// The published JSON Schema for an operator-graph project, at noodles-project.v<N>.schema.json.
// Its text is what main published for version 19, so that file stays as it is.
export function projectJsonSchema(version: number): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(projectSchema(version), {
    // The meta id names the $defs entry, but zod also copies it into the definition
    override: ({ jsonSchema }) => {
      delete jsonSchema.id
    },
  }) as Record<string, unknown>
  return {
    $schema,
    $id: `${SCHEMA_BASE_URL}/${schemaFileName(version)}`,
    title: `Noodles.gl project file (version ${version})`,
    description:
      'A noodles.json file. Covers file shape only; check operator types, inputs and edge handles with noodles-validate.',
    ...rest,
  }
}

// ============================================================================
// Documents
// ============================================================================

// A parameter's value: a literal, an expression, a reference, or a host operator's own
// serialized value (code lines, a compound object)
const paramValue = z
  .union([
    z.number(),
    z.boolean(),
    z.string(),
    z
      .strictObject({ expr: z.string() })
      .describe("An expression: T seconds, F frame, ch('node/param'), math"),
    z.strictObject({ ref: z.string() }).describe("Another node's parameter, e.g. points/radius"),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ])
  .meta({ id: 'ParamValue' })

const docNode = z.strictObject({
  id: z.string().min(1).describe('Opaque and stable; edges and parent name nodes by id'),
  op: z.string().min(1).describe('Operator type, e.g. file, scatter, deck'),
  name: z
    .string()
    .regex(/^[^/\s]+$/)
    .optional()
    .describe('Unique within its network; paths use it. Defaults to the id'),
  parent: z.string().optional().describe('Id of the subnet it is inside; absent at the root'),
  x: z.number(),
  y: z.number(),
  params: z
    .record(z.string(), paramValue)
    .describe('Parameters that differ from the defaults, by name'),
  flags: z
    .strictObject({
      bypass: z.boolean().optional().describe('Pass the first table input through'),
      display: z.boolean().optional().describe("Preview the node's rows"),
    })
    .optional(),
  promoted: z
    .array(
      z.strictObject({
        name: z.string(),
        label: z.string().optional(),
        node: z.string().describe("The child's id"),
        param: z.string(),
      })
    )
    .optional()
    .describe("A subnet's parameters, each driving a child's parameter"),
})

const docEdge = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1).describe('Node id'),
  sourcePort: z.string().min(1).describe('An output port, e.g. out'),
  target: z.string().min(1).describe('Node id'),
  targetPort: z
    .string()
    .min(1)
    .describe('An input port, e.g. in, or par:<name> to drive a parameter'),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Order among edges into a multi-input port, such as the deck's layers"),
})

const docKeyframe = z.strictObject({
  id: z.string(),
  time: z.number().min(0).describe('Seconds'),
  value: z.union([z.number(), z.string()]).describe('A number eases; text holds'),
  interpolation: z
    .enum(['bezier', 'linear', 'hold'])
    .describe('How the segment leaving this keyframe interpolates'),
  handles: z
    .strictObject({
      left: z.tuple([unit, z.number()]).meta({ minItems: 2, maxItems: 2 }),
      right: z.tuple([unit, z.number()]).meta({ minItems: 2, maxItems: 2 }),
    })
    .optional()
    .describe('Bezier control points, as CSS cubic-bezier(left, right)'),
})

const docTrack = z.strictObject({
  target: z
    .string()
    .regex(/^[^.]+\..+$/)
    .describe('The parameter it drives: <node id>.<param>, e.g. deck.bearing'),
  keyframes: z
    .array(docKeyframe)
    .refine(
      keyframes => keyframes.every((kf, i) => i === 0 || keyframes[i - 1].time <= kf.time),
      'Keyframes are sorted by time'
    )
    .describe('Sorted by time'),
})

export function documentSchema(version = DOCUMENT_VERSION) {
  return z.strictObject({
    $schema: z.string().optional(),
    version: z.literal(version).describe('Document version'),
    name: z.string(),
    description: z.string().optional(),
    nodes: z.array(docNode),
    edges: z.array(docEdge),
    timeline: z
      .strictObject({
        length: z.number().positive().describe('Seconds'),
        fps: z.number().positive(),
        tracks: z.array(docTrack),
      })
      .optional(),
    credits: z.array(z.string()).optional().describe('Attribution for the data it uses'),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Editor state saved with it, such as the viewport'),
  })
}

// The published document JSON Schema. versioned names the pinned copy, whose $id stays fixed.
export function documentJsonSchema(
  version = DOCUMENT_VERSION,
  { versioned = false } = {}
): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(documentSchema(version), {
    override: ({ jsonSchema }) => {
      delete jsonSchema.id
    },
  }) as Record<string, unknown>
  return {
    $schema,
    $id: `${SCHEMA_BASE_URL}/${versioned ? documentSchemaFileName(version) : schemaFileName()}`,
    title: `Noodles.gl project document (version ${version})`,
    description:
      'A noodles.json document. Covers file shape only; check operators, parameters and ports with noodles-validate.',
    ...rest,
  }
}
