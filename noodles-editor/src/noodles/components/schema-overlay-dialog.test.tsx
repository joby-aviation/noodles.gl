import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSchemaOverlayPreview } from '../table-schema-clipboard'
import { ClipboardPasteDialog, SchemaOverlayDialog } from './schema-overlay-dialog'

afterEach(cleanup)

describe('SchemaOverlayDialog', () => {
  it('defaults safe additions to apply and submits the selected decisions', () => {
    const preview = createSchemaOverlayPreview(
      { columns: [{ name: 'name', type: 'string', defaultValue: '' }] },
      [{ name: 'Alice' }],
      { name: 'anchor', type: 'string', defaultValue: 'start' }
    )
    const onApply = vi.fn()

    render(
      <SchemaOverlayDialog
        open
        preview={preview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={onApply}
      />
    )

    expect(screen.getByText('add')).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Decision for anchor' })).toHaveValue('apply')
    fireEvent.click(screen.getByRole('button', { name: 'Apply Overlay' }))
    expect(onApply).toHaveBeenCalledWith({ 0: 'apply' })
  })

  it('shows invalid clipboard errors without an apply action', () => {
    render(
      <SchemaOverlayDialog
        open
        error="Clipboard text is not valid JSON."
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Clipboard text is not valid JSON.')
    expect(screen.queryByRole('button', { name: 'Apply Overlay' })).toBeNull()
  })

  it('does not apply changes when canceled', () => {
    const preview = createSchemaOverlayPreview(
      { columns: [{ name: 'name', type: 'string', defaultValue: '' }] },
      [{ name: 'Alice' }],
      { name: 'anchor', type: 'string', defaultValue: 'start' }
    )
    const onApply = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <SchemaOverlayDialog
        open
        preview={preview}
        onOpenChange={onOpenChange}
        onRenameIncoming={vi.fn()}
        onApply={onApply}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('preserves an explicit decision when a rename recomputes the preview', () => {
    const targetSchema = {
      columns: [{ id: 'value', name: 'value', type: 'string' as const, defaultValue: '' }],
    }
    const targetData = [{ value: '42' }]
    const preview = createSchemaOverlayPreview(targetSchema, targetData, {
      id: 'value',
      name: 'value',
      type: 'number',
      defaultValue: 0,
    })
    const { rerender } = render(
      <SchemaOverlayDialog
        open
        preview={preview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={vi.fn()}
      />
    )

    const decision = screen.getByRole('combobox', { name: 'Decision for value' })
    expect(decision).toHaveValue('apply')
    fireEvent.change(decision, { target: { value: 'keep' } })
    expect(screen.getByText('1 values preserved')).toBeDefined()
    expect(screen.getByText('0 values coerced')).toBeDefined()

    const renamedPreview = createSchemaOverlayPreview(targetSchema, targetData, {
      id: 'value',
      name: 'display_value',
      type: 'number',
      defaultValue: 0,
    })
    rerender(
      <SchemaOverlayDialog
        open
        preview={renamedPreview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Decision for display_value' })).toHaveValue('keep')
    expect(screen.getByText('1 values preserved')).toBeDefined()
    expect(screen.getByText('0 values coerced')).toBeDefined()
  })

  it('forces a conflicting explicit apply decision to keep safely', () => {
    const targetSchema = {
      columns: [
        { id: 'value', name: 'value', type: 'string' as const, defaultValue: '' },
        { id: 'taken', name: 'taken', type: 'string' as const, defaultValue: '' },
      ],
    }
    const targetData = [{ value: '42', taken: 'existing' }]
    const safePreview = createSchemaOverlayPreview(targetSchema, targetData, {
      id: 'value',
      name: 'value',
      type: 'number',
      defaultValue: 0,
    })
    const onApply = vi.fn()
    const { rerender } = render(
      <SchemaOverlayDialog
        open
        preview={safePreview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={onApply}
      />
    )

    const decision = screen.getByRole('combobox', { name: 'Decision for value' })
    fireEvent.change(decision, { target: { value: 'keep' } })
    fireEvent.change(decision, { target: { value: 'apply' } })

    const conflictingPreview = createSchemaOverlayPreview(targetSchema, targetData, {
      id: 'value',
      name: 'taken',
      type: 'number',
      defaultValue: 0,
    })
    rerender(
      <SchemaOverlayDialog
        open
        preview={conflictingPreview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={onApply}
      />
    )

    const conflictingDecision = screen.getByRole('combobox', { name: 'Decision for taken' })
    expect(conflictingDecision).toHaveValue('keep')
    expect(screen.queryByRole('option', { name: /apply/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Apply Overlay' }))
    expect(onApply).toHaveBeenLastCalledWith({ 0: 'keep' })

    const resolvedPreview = createSchemaOverlayPreview(targetSchema, targetData, {
      id: 'value',
      name: 'display_value',
      type: 'number',
      defaultValue: 0,
    })
    rerender(
      <SchemaOverlayDialog
        open
        preview={resolvedPreview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={onApply}
      />
    )
    expect(screen.getByRole('combobox', { name: 'Decision for display_value' })).toHaveValue(
      'apply'
    )
  })

  it('updates conversion totals to reflect keep versus apply', () => {
    const preview = createSchemaOverlayPreview(
      { columns: [{ id: 'value', name: 'value', type: 'string', defaultValue: '' }] },
      [{ value: 'not a number' }],
      { id: 'value', name: 'value', type: 'number', defaultValue: 0 }
    )
    render(
      <SchemaOverlayDialog
        open
        preview={preview}
        onOpenChange={vi.fn()}
        onRenameIncoming={vi.fn()}
        onApply={vi.fn()}
      />
    )

    const decision = screen.getByRole('combobox', { name: 'Decision for value' })
    expect(decision).toHaveValue('keep')
    expect(screen.getByText('1 values preserved')).toBeDefined()
    expect(screen.getByText('0 values coerced')).toBeDefined()
    expect(screen.getByText('0 values would reset')).toBeDefined()

    fireEvent.change(decision, { target: { value: 'apply' } })
    expect(screen.getByText('0 values preserved')).toBeDefined()
    expect(screen.getByText('0 values coerced')).toBeDefined()
    expect(screen.getByText('1 values would reset')).toBeDefined()
  })
})

describe('ClipboardPasteDialog', () => {
  it('supports data-specific fallback copy without changing schema defaults', () => {
    const onOpenChange = vi.fn()
    const onPasteText = vi.fn()
    render(
      <ClipboardPasteDialog
        open
        title="Paste Table Data"
        description="Press Cmd+V or Ctrl+V to import data."
        ariaLabel="Paste table data"
        placeholder="Paste rows here"
        onOpenChange={onOpenChange}
        onPasteText={onPasteText}
      />
    )

    expect(screen.getByRole('heading', { name: 'Paste Table Data' })).toBeDefined()
    const target = screen.getByLabelText('Paste table data')
    expect(target).toHaveAttribute('placeholder', 'Paste rows here')
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: () => 'a\tb' },
    })
    fireEvent(target, pasteEvent)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onPasteText).toHaveBeenCalledWith('a\tb')
  })
})
