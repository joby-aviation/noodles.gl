/**
 * Headless core: everything from a JSON graph to a physical plan, with no GPU, no DOM and
 * no database driver.
 *
 * `apache-arrow` is used for types only, so the built output has no runtime imports at all.
 * Import this entry to use the expression IR,
 * the planner and the cost model on their own — a build step, a server, or a test can plan a
 * graph and inspect the generated SQL and WGSL without ever creating a device.
 */

// --- expression IR ---------------------------------------------------------
export {
  parseExpr, walk, columnsOf, paramsOf, simplifyExpr, enginesFor, compactable, isAggregate, widthOf,
  FUNCTIONS, ExprError,
  type Expr, type UnaryOp, type BinaryOp, type Engine, type FnSpec, type WidthEnv,
} from './expr.js';

// --- backends --------------------------------------------------------------
export {
  toSql, toSqlColumns, quoteIdent, castToFloat, castToDouble, SqlParams, type SqlEmit,
} from './backends/sql.js';
export {
  toWgsl, wgslType, wgslParamMember, type Resolver, type WgslEmit,
} from './backends/wgsl.js';
export { toJs, type JsResolver, type JsEmit } from './backends/js.js';

// --- attribute vocabulary --------------------------------------------------
export {
  attributeConventions, isInternal, HOUDINI_CONVENTIONS,
  type AttributeConventions,
} from './conventions.js';
export {
  packedColorName, positionFormat, rowBytes, unpackRgba8, splitHiLo, joinHiLo, type AttributeFormat,
} from './packing.js';

// --- user-defined functions ------------------------------------------------
export {
  buildRegistry, defineFunction, addFunction, inlineFunctions,
  parseFunctionDeclaration, FunctionError, GEO_SOURCE_PREFIX,
  type FunctionDef, type FunctionSpec, type FunctionRegistry,
} from './functions.js';

// --- hoisting: param-only subexpressions as derived parameters -------------
export {
  HOIST_PREFIX, hoistParams, derivedValues, withDerived, sourceParams, paramLabel,
  type DerivedParam, type WithDerived,
} from './hoist.js';

// --- geospatial functions: inlined point operations, expanded literal geometries --
export {
  GEO_PRELUDE, GEO_SPECS, GEO_MACROS, EARTH_RADIUS_M, WEB_MERCATOR_RADIUS_M, WEB_MERCATOR_MAX_LAT,
} from './geo.js';
export {
  type Geometry, type Position, GeometryError, MAX_GEOMETRY_VERTICES, parseGeometry,
  areaM2, lengthM, perimeterM, bboxOf, centroidOf, vertexMean,
} from './geometry.js';

// --- graph schema and sugar ------------------------------------------------
export {
  desugar, statExpr, statParamName, buildRampLut, RAMP_STOPS,
  type Graph, type GraphNode, type CoreNode, type ParamSpec, type RampName,
  type SourceNode, type FilterNode, type AggregateNode, type StatsNode, type StatOp,
  type AttributeNode, type ScaleNode, type ColorScaleNode, type ProjectNode,
  type WrangleNode, type Bin2dNode, type RenderNode, type RawNode, type LayerNode,
  type FileSource, type JoinNode, type UnionNode, type SortNode, type LimitNode, type SqlNode,
  type GenerateNode, type UnnestNode, type VerticesNode, type DeckNode, type RelationalNode, RELATIONAL_TYPES,
} from './types.js';
export {
  LAYER_KINDS, LAYER_SPECS, propParam, propParams, resolveProps, type ResolvedProp,
  type LayerKind, type LayerKindSpec, type ChannelSpec, type ChannelType, type LayerPropValue,
} from './layers.js';
export {
  parseWrangle, expandWrangle, localName, renameColumns, WrangleError,
  type WrangleStatement,
} from './wrangle.js';

// --- programs: many sources, relational nodes, many layers -----------------
export { canonicalJson, hashOf } from './hash.js';
export {
  columnTypeOf, pathColumnOf, sqlLiteral, inlineParamsInText, exprError,
  numericListOf, listLengthsSql, parseListLengths, listVectors, listComponentsSql, listComponentColumns,
  sourceSql, verticesSql, joinSql, unionSql, sortSql, limitSql, sqlNodeSql, generateSql, unnestSql, rowwiseSql,
  type RelColumn, type RelVector, type RelShape,
} from './relational.js';
export {
  compileProgram, inputsOf, resolveView,
  type ProgramPlan, type RelationPlan, type LayerPlan, type NodeInfo, type Route,
  type ParamRouteEntry, type Catalog, type CatalogEntry, type CompileOptions,
} from './program.js';

// --- editor documents, operators, parameters over time -------------------
export {
  cubicBezier, findTForX, bezierEasing, evaluateTrack, setKeyframe, keyframeAt, presetName,
  EASING_PRESETS, LINEAR_HANDLES,
  type Keyframe, type KeyframeValue, type Track, type Timeline, type BezierHandles, type InterpolationType,
} from './keyframes.js';
export {
  flattenSubnets, applyBypass, resolveRef, networkPath, nodePath, nameOf, isExpr, isRef,
  DocumentError, SUBNET, SUBNET_INPUT, SUBNET_OUTPUT,
  type EditorDoc, type DocNode, type DocEdge, type ParamValue, type PromotedParam,
} from './doc.js';
export {
  OPERATORS, OPERATOR_INDEX, operator, bindingOf, histogramSql, canConnect, paramAccepts, paramPort, safeId, registerRamp, registerOperator,
  type OpDef, type ParamDef, type ParamKind, type PortSpec, type PortType, type Category,
  type LowerCtx, type LowerResult, type ScalarParams,
} from './operators.js';
export {
  lowerDocument, parameterValues, slotKey, outputKey, ScalarProgram,
  type Lowered, type LoweredParam, type LowerOptions, type SlotValue, type Clock, type External,
} from './lower.js';

// --- planning --------------------------------------------------------------
export {
  analyze, opCount, PlanError, externalAttributes,
  type Analysis, type AnalyzedNode, type AnalyzeOptions, type Schema, type Stage, type RenderChannels,
  type LayerAnalysis, type LayerBinding, type ColumnType, type ColumnTypes, type PathColumnKind, type PathColumns,
} from './analyze.js';
export {
  optimize, stageOf, sameAssignment,
  type Policy, type Assignment, type Candidate, type OptimizeContext, type OptimizeResult,
} from './optimizer.js';
export {
  plan, WORKGROUP, DEFAULT_RELATION, bufName,
  type PhysicalPlan, type PlanOptions, type AttributeDecl, type KernelPlan,
  type StatsPlan, type StageNode, type RawStage, type Explain,
} from './planner.js';

// --- cost model and statistics --------------------------------------------
export {
  DEFAULT_COSTS, CostAccumulator, emptyBreakdown,
  sqlScanMs, uploadMs, castMs, interleaveMs, kernelMs, cpuEvalMs, renderFrameMs, compactMs,
  estimateChunks, DUCKDB_BATCH_ROWS,
  type CostConstants, type CostBreakdown, type CostTerm,
} from './cost.js';
export {
  statsSql, parseStatsRow, estimateSelectivity, attributeBytes, referencedColumns,
  DEFAULT_SELECTIVITY,
  type ColumnStats, type SourceStats,
} from './stats.js';

// --- targets ---------------------------------------------------------------
export {
  targetCaps, withCompaction, TARGET_IDS, type TargetId, type TargetCaps, type DeviceLimits,
} from './target.js';

// --- data sources ----------------------------------------------------------
export {
  SourceRegistry, relationSource, parquetUrlSource, sqlSource,
  quoteRelation, escapeLiteral,
  type SqlEngine, type SourceProvider, type QueryTiming,
} from './source.js';

// --- Arrow -> f32 and the CPU stage ---------------------------------------
export {
  readColumn, readVectorColumns, readStrings, readValues, runStarts, ringStarts, type Tier, type ColumnUpload,
} from './arrow.js';
export {
  evaluateStage, materialize, toUint8Color, type CpuAttributes,
} from './cpu-stage.js';
export { udfRegistrations, registerUdfs, type UdfSpec, type UdfParam, type UdfRegistration } from './udfs.js';
