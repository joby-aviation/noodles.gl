import type { Node as ReactFlowNode } from '@xyflow/react'
import { assert, describe, expect, it, vi } from 'vitest'
import createFetchMock from 'vitest-fetch-mock'
import type { Edge } from './noodles'
import { type IOperator, MathOp, NumberOp, type Operator, StringOp } from './operators'
import { transformGraph } from './transform-graph'

const fetchMocker = createFetchMock(vi)

describe('nodes', () => {
  it('transforms the graph', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graph)
    assert.equal(instances.length, 2)

    const [num, add] = instances
    assert.instanceOf(num, NumberOp)
    expect(num.data.val).toEqual(5)

    assert.instanceOf(add, MathOp)
    expect(add.data.operator).toEqual('add')
  })

  it('works with qualified handle IDs', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graph)

    assert.equal(instances.length, 2)

    const [num, add] = instances
    assert.instanceOf(num, NumberOp)
    assert.instanceOf(add, MathOp)

    // Verify that IDs are qualified
    expect(num.id).toBe('/num')
    expect(add.id).toBe('/add')

    // Verify that the connection was established properly
    expect(add.inputs.a.subscriptions.size).toBe(1)

    // Verify that the operators work correctly
    expect(num.data.val).toEqual(5)
    expect(add.data.operator).toEqual('add')
  })

  it('works with more complex graphs', () => {
    fetchMocker.enableMocks()

    // Simplified graph with multiple operators and qualified IDs
    const complexGraph = {
      nodes: [
        {
          id: '/topic',
          type: 'StringOp',
          data: { inputs: { val: 'AdsbTelemetryMessageJson' } },
          position: { x: -3577, y: -1177 },
        },
        {
          id: '/num1',
          type: 'NumberOp',
          data: { inputs: { val: 10 } },
          position: { x: -3000, y: -1000 },
        },
        {
          id: '/num2',
          type: 'NumberOp',
          data: { inputs: { val: 5 } },
          position: { x: -3000, y: -800 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add' } },
          position: { x: -2500, y: -900 },
        },
        {
          id: '/multiply',
          type: 'MathOp',
          data: { inputs: { operator: 'multiply', b: 2 } },
          position: { x: -2000, y: -900 },
        },
      ],
      edges: [
        {
          source: '/num1',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num1.out.val->/add.par.a',
        },
        {
          source: '/num2',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.b',
          id: '/num2.out.val->/add.par.b',
        },
        {
          source: '/add',
          target: '/multiply',
          sourceHandle: 'out.result',
          targetHandle: 'par.a',
          id: '/add.out.result->/multiply.par.a',
        },
      ],
    }

    const instances = transformGraph(complexGraph)
    assert.equal(instances.length, 5)

    // Verify all instances have qualified IDs
    const topic = instances.find(i => i.id === '/topic')!
    const num1 = instances.find(i => i.id === '/num1')!
    const num2 = instances.find(i => i.id === '/num2')!
    const add = instances.find(i => i.id === '/add')!
    const multiply = instances.find(i => i.id === '/multiply')!

    assert.instanceOf(topic, StringOp)
    assert.instanceOf(num1, NumberOp)
    assert.instanceOf(num2, NumberOp)
    assert.instanceOf(add, MathOp)
    assert.instanceOf(multiply, MathOp)

    // Verify connections were established
    expect(add.inputs.a.subscriptions.size).toBe(1)
    expect(add.inputs.b.subscriptions.size).toBe(1)
    expect(multiply.inputs.a.subscriptions.size).toBe(1)

    // Verify data flows correctly
    expect(num1.data.val).toEqual(10)
    expect(num2.data.val).toEqual(5)
    expect(add.data.operator).toEqual('add')
    expect(multiply.data.operator).toEqual('multiply')

    // Test that the topic operator works independently
    expect(topic.inputs.val.value).toEqual('AdsbTelemetryMessageJson')
    topic.inputs.val.setValue('AnotherValue')
    expect(topic.inputs.val.getValue()).toEqual('AnotherValue')

    fetchMocker.dontMock()
  })

  it('fails gracefully on cycles', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/add.par.a',
        },
        {
          source: '/add',
          target: '/num',
          sourceHandle: 'out.a',
          targetHandle: 'par.val',
          id: '/add.out.a->/num.par.val',
        },
      ],
    }

    // TODO: check for cycles and throw an error
    expect(() => transformGraph(graph)).not.toThrowError()
    expect(transformGraph(graph).length).toEqual(0)
  })

  it('fails gracefully on missing fields', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        { id: '/add', type: 'MathOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
      ],
      edges: [
        {
          source: '/num',
          target: '/MISSING',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/MISSING.par.a',
        },
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.INVALID',
          id: '/num.out.val->/add.par.INVALID',
        },
      ],
    }

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => transformGraph(graph)).not.toThrowError()
    expect(consoleWarn).toHaveBeenCalledWith('Invalid connection')
    expect(transformGraph(graph).length).toEqual(2)
  })
})
