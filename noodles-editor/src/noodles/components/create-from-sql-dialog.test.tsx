import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateFromSQLDialog } from './create-from-sql-dialog'

afterEach(() => {
  cleanup()
})

describe('CreateFromSQLDialog', () => {
  const sql = "SELECT * FROM 'https://example.com/data.parquet'"

  it('is closed when there is no pending SQL', () => {
    render(<CreateFromSQLDialog sql={null} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the SQL from the link', () => {
    render(<CreateFromSQLDialog sql={sql} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText(sql)).toBeDefined()
  })

  it('runs the query only after the user confirms', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<CreateFromSQLDialog sql={sql} onConfirm={onConfirm} onClose={onClose} />)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))
    expect(onConfirm).toHaveBeenCalledWith(sql)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not run the query when cancelled', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<CreateFromSQLDialog sql={sql} onConfirm={onConfirm} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
