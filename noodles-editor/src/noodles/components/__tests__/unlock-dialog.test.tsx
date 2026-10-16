import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MathOp } from '../../operators'
import { registerLockChangeCallback } from '../../utils/lock-history'
import { NodeHeader } from '../op-components'

function renderHeader(op: MathOp) {
  return render(
    <ReactFlowProvider>
      <NodeHeader id={op.id} type="MathOp" op={op} />
    </ReactFlowProvider>
  )
}

const lockButton = () => screen.getByTitle('Toggle lock')

describe('NodeHeader unlock confirmation', () => {
  afterEach(() => {
    cleanup()
    registerLockChangeCallback(undefined)
  })

  it('asks before unlocking a node that holds output', async () => {
    const op = new MathOp('/drive-directions', { operator: 'add', a: 2, b: 3 })
    await op.pull()
    op.locked.next(true)
    const onLockChange = vi.fn()
    registerLockChangeCallback(onLockChange)
    renderHeader(op)

    fireEvent.click(lockButton())

    expect(screen.getByRole('dialog')).toHaveTextContent('runs this node again')
    expect(op.locked.value).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(op.locked.value).toBe(false)
    expect(onLockChange).toHaveBeenCalledTimes(1)
    expect(onLockChange).toHaveBeenCalledWith(
      'Unlock drive-directions',
      expect.objectContaining({ locked: false, outputsBefore: { result: 5 } })
    )
  })

  it('keeps the node locked and records nothing on Cancel', async () => {
    const op = new MathOp('/drive-directions', { operator: 'add', a: 2, b: 3 })
    await op.pull()
    op.locked.next(true)
    const onLockChange = vi.fn()
    registerLockChangeCallback(onLockChange)
    renderHeader(op)

    fireEvent.click(lockButton())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(op.locked.value).toBe(true)
    expect(onLockChange).not.toHaveBeenCalled()
  })

  it('locks without asking', () => {
    const op = new MathOp('/math', { operator: 'add', a: 2, b: 3 })
    const onLockChange = vi.fn()
    registerLockChangeCallback(onLockChange)
    renderHeader(op)

    fireEvent.click(lockButton())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(op.locked.value).toBe(true)
    expect(onLockChange).toHaveBeenCalledWith(
      'Lock math',
      expect.objectContaining({ locked: true })
    )
  })

  it('unlocks a node with no output without asking', () => {
    const op = new MathOp('/math', { operator: 'add', a: 2, b: 3 }, true)
    renderHeader(op)

    fireEvent.click(lockButton())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(op.locked.value).toBe(false)
  })
})
