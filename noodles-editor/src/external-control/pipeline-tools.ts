// Pipeline-specific tools for automated data pipeline creation and testing

import { opTypes } from '../noodles/operators'
import { toolRegistry } from './tool-adapter'

export interface PipelineSpec {
  nodes: Array<{
    id: string
    type: string
    position?: { x: number; y: number }
    data?: {
      inputs?: Record<string, unknown>
    }
  }>
  edges: Array<{
    id?: string
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }>
}

export interface PipelineHandle {
  id: string
  nodes: string[]
  edges: string[]
  spec: PipelineSpec
}

export interface TestResult {
  pipelineId: string
  success: boolean
  outputs: Record<string, unknown>
  errors: Array<{
    nodeId: string
    error: string
  }>
  executionTime: number
  intermediateResults?: Record<string, unknown>
}

export interface ValidationResult {
  valid: boolean
  errors: Array<{
    type: 'missing_connection' | 'type_mismatch' | 'invalid_config' | 'cycle_detected'
    nodeId?: string
    edgeId?: string
    message: string
  }>
  warnings: Array<{
    type: string
    message: string
  }>
}

// Pipeline manager for creating and managing data pipelines
export class PipelineManager {
  private pipelines = new Map<string, PipelineHandle>()

  constructor() {
    this.registerPipelineTools()
  }

  // Register pipeline-specific tools
  private registerPipelineTools() {
    toolRegistry.register({
      name: 'createPipeline',
      description: 'Create a complete data pipeline from specification',
      parameters: {
        spec: {
          type: 'object',
          description: 'Pipeline specification',
          required: true,
        },
        options: {
          type: 'object',
          description: 'Creation options',
          default: {
            validateFirst: true,
            autoConnect: true,
            autoLayout: true,
          },
        },
      },
    })

    toolRegistry.register({
      name: 'testPipeline',
      description: 'Test a pipeline with sample data',
      parameters: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID',
          required: true,
        },
        testData: {
          type: 'array',
          description: 'Test data to inject',
          required: true,
        },
        options: {
          type: 'object',
          description: 'Test options',
          default: {
            timeout: 30000,
            captureIntermediateResults: false,
          },
        },
      },
    })

    toolRegistry.register({
      name: 'validatePipeline',
      description: 'Validate pipeline connections and configuration',
      parameters: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID',
          required: true,
        },
      },
    })

    toolRegistry.register({
      name: 'uploadDataFile',
      description: 'Upload a data file for use in pipelines',
      parameters: {
        filename: {
          type: 'string',
          description: 'File name',
          required: true,
        },
        content: {
          type: 'string',
          description: 'File content (base64 encoded for binary)',
          required: true,
        },
        mimeType: {
          type: 'string',
          description: 'MIME type',
          default: 'text/csv',
        },
        encoding: {
          type: 'string',
          description: 'Content encoding (utf-8, base64, binary)',
          default: 'utf-8',
        },
      },
    })

    toolRegistry.register({
      name: 'getPipelineInfo',
      description: 'Get information about a pipeline',
      parameters: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID',
          required: true,
        },
      },
    })

    toolRegistry.register({
      name: 'deletePipeline',
      description: 'Delete a pipeline and all its nodes',
      parameters: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID',
          required: true,
        },
      },
    })
  }

  // Create a pipeline from specification
  async createPipeline(
    spec: PipelineSpec,
    options = {
      validateFirst: true,
    }
  ): Promise<PipelineHandle> {
    const nodeIds: string[] = []
    const edgeIds: string[] = []
    const modifications: {
      nodes: Array<{ type: 'add'; node: unknown }>
      edges: Array<{ type: 'add'; edge: unknown }>
    } = {
      nodes: [],
      edges: [],
    }

    // Validate spec first if requested
    if (options.validateFirst) {
      this.validateSpec(spec)
    }

    // Create nodes
    for (const node of spec.nodes) {
      nodeIds.push(node.id)
      modifications.nodes.push({
        type: 'add',
        node: {
          id: node.id,
          type: node.type,
          position: node.position || { x: 100, y: 100 },
          data: node.data || {},
        },
      })
    }

    // Create edges
    for (const edge of spec.edges) {
      const edgeId =
        edge.id || `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`
      edgeIds.push(edgeId)
      modifications.edges.push({
        type: 'add',
        edge: {
          id: edgeId,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        },
      })
    }

    // Apply modifications
    await toolRegistry.execute('applyModifications', { modifications })

    // Store pipeline handle
    // Use the first node as the pipeline ID, or generate one if no nodes
    const pipelineId = nodeIds.length > 0 ? nodeIds[0] : `/pipeline-${Date.now()}`
    const handle: PipelineHandle = {
      id: pipelineId,
      nodes: nodeIds,
      edges: edgeIds,
      spec,
    }
    this.pipelines.set(pipelineId, handle)

    return handle
  }

  // Test a pipeline with sample data
  async testPipeline(
    pipelineId: string,
    testData: unknown[],
    options = {
      timeout: 30000,
      captureIntermediateResults: false,
    }
  ): Promise<TestResult> {
    const startTime = Date.now()
    const pipeline = this.pipelines.get(pipelineId)

    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`)
    }

    const result: TestResult = {
      pipelineId,
      success: true,
      outputs: {},
      errors: [],
      executionTime: 0,
    }

    if (options.captureIntermediateResults) {
      result.intermediateResults = {}
    }

    try {
      // Inject test data into the source node
      const sourceNodeId = pipeline.nodes[0]
      if (sourceNodeId) {
        // TODO: Implement actual data injection
        // This would require modifying the source node's input data
        console.log('Injecting test data into', sourceNodeId, testData)
      }

      // Wait for pipeline execution (with timeout)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pipeline test timeout')), options.timeout)
      )

      // Capture outputs from all nodes
      for (const nodeId of pipeline.nodes) {
        try {
          const output = await Promise.race([
            toolRegistry.execute('getNodeOutput', {
              nodeId,
              outputName: 'result',
            }),
            timeoutPromise,
          ])

          if (output?.success) {
            result.outputs[nodeId] = output.result

            if (options.captureIntermediateResults) {
              result.intermediateResults![nodeId] = output.result
            }
          }
        } catch (error) {
          result.errors.push({
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          })
          result.success = false
        }
      }
    } catch (error) {
      result.success = false
      result.errors.push({
        nodeId: pipelineId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    result.executionTime = Date.now() - startTime
    return result
  }

  // Validate a pipeline
  async validatePipeline(pipelineId: string): Promise<ValidationResult> {
    const pipeline = this.pipelines.get(pipelineId)

    if (!pipeline) {
      return {
        valid: false,
        errors: [
          {
            type: 'invalid_config',
            message: `Pipeline not found: ${pipelineId}`,
          },
        ],
        warnings: [],
      }
    }

    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    // Get current project state
    const projectState = await toolRegistry.execute('getCurrentProject', {})

    if (!projectState.success || !projectState.result) {
      return {
        valid: false,
        errors: [
          {
            type: 'invalid_config',
            message: 'Failed to get project state',
          },
        ],
        warnings: [],
      }
    }

    const { nodes, edges } = projectState.result as {
      nodes: Array<{ id: string }>
      edges: Array<{ id: string; source: string; target: string }>
    }

    // Check all pipeline nodes exist
    for (const nodeId of pipeline.nodes) {
      const node = nodes.find(n => n.id === nodeId)
      if (!node) {
        errors.push({
          type: 'invalid_config',
          nodeId,
          message: `Node not found in project: ${nodeId}`,
        })
      }
    }

    // Check all edges are valid
    for (const edgeId of pipeline.edges) {
      const edge = edges.find(e => e.id === edgeId)
      if (!edge) {
        errors.push({
          type: 'missing_connection',
          edgeId,
          message: `Edge not found in project: ${edgeId}`,
        })
      }
    }

    // Check for cycles (simple check - could be more sophisticated)
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId)
      recursionStack.add(nodeId)

      const outgoingEdges = edges.filter(e => e.source === nodeId)
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          if (hasCycle(edge.target)) return true
        } else if (recursionStack.has(edge.target)) {
          return true
        }
      }

      recursionStack.delete(nodeId)
      return false
    }

    // Check for cycles starting from source node
    if (pipeline.nodes.length > 0 && hasCycle(pipeline.nodes[0])) {
      errors.push({
        type: 'cycle_detected',
        message: 'Pipeline contains a cycle',
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  // Validate pipeline specification
  private validateSpec(spec: PipelineSpec) {
    // Check nodes
    if (!spec.nodes || spec.nodes.length === 0) {
      throw new Error('Pipeline spec must include at least one node')
    }

    for (const node of spec.nodes) {
      if (!node.id) {
        throw new Error('Each node must have an id')
      }
      if (!node.type) {
        throw new Error(`Node ${node.id} must have a type`)
      }
      if (!opTypes[node.type]) {
        throw new Error(`Unknown node type: ${node.type}`)
      }
    }

    // Check edges
    for (const edge of spec.edges || []) {
      if (!edge.source) {
        throw new Error('Each edge must have a source')
      }
      if (!edge.target) {
        throw new Error('Each edge must have a target')
      }
      if (!edge.sourceHandle) {
        throw new Error('Each edge must have a sourceHandle')
      }
      if (!edge.targetHandle) {
        throw new Error('Each edge must have a targetHandle')
      }

      // Check that source and target nodes exist
      const sourceExists = spec.nodes.some(n => n.id === edge.source)
      const targetExists = spec.nodes.some(n => n.id === edge.target)

      if (!sourceExists) {
        throw new Error(`Edge source node not found: ${edge.source}`)
      }
      if (!targetExists) {
        throw new Error(`Edge target node not found: ${edge.target}`)
      }
    }
  }

  // Get pipeline information
  getPipelineInfo(pipelineId: string): PipelineHandle | undefined {
    return this.pipelines.get(pipelineId)
  }

  // Delete a pipeline
  async deletePipeline(pipelineId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`)
    }

    // Delete all nodes in the pipeline
    const modifications = {
      nodes: pipeline.nodes.map(nodeId => ({
        type: 'delete',
        nodeId,
      })),
    }

    await toolRegistry.execute('applyModifications', { modifications })
    this.pipelines.delete(pipelineId)
  }
}

// Export singleton instance
export const pipelineManager = new PipelineManager()
