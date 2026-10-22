import { describe, expect, it } from 'vitest'
import type { DataKeyDefinition, ExpressionContext } from '../utils/expression-context'
import { createExpressionCompletionProvider } from './expression-completions'

const monaco = {
  languages: {
    CompletionItemKind: {
      Property: 1,
      Snippet: 2,
      Text: 3,
      Function: 4,
      Module: 5,
      Variable: 6,
      Method: 7,
      Reference: 8,
    },
  },
}

interface TestCompletionItem {
  label: string
  insertText: string
  range: {
    startLineNumber: number
    endLineNumber: number
    startColumn: number
    endColumn: number
  }
}

function complete(text: string, dataKeys: DataKeyDefinition[]) {
  const context: ExpressionContext = {
    dataKeys,
    globals: [],
    operatorPaths: [],
  }
  const provider = createExpressionCompletionProvider(monaco, () => context)
  const word = text.match(/[$\w]*$/)?.[0] ?? ''
  const position = { lineNumber: 1, column: text.length + 1 }
  const model = {
    getWordUntilPosition: () => ({
      startColumn: position.column - word.length,
      endColumn: position.column,
    }),
    getValueInRange: () => text,
  }

  return provider.provideCompletionItems(model, position).suggestions as TestCompletionItem[]
}

describe('expression data-property completions', () => {
  it('replaces dot notation with bracket notation for keys containing spaces', () => {
    const suggestion = complete('d.Dis', [{ label: 'Display Name', path: ['Display Name'] }]).find(
      item => item.label === 'Display Name'
    )

    expect(suggestion).toMatchObject({
      insertText: '["Display Name"]',
      range: {
        startLineNumber: 1,
        endLineNumber: 1,
        startColumn: 2,
        endColumn: 6,
      },
    })
  })

  it('keeps dot notation for valid JavaScript property identifiers', () => {
    const suggestion = complete('d.Dis', [{ label: 'DisplayName', path: ['DisplayName'] }]).find(
      item => item.label === 'DisplayName'
    )

    expect(suggestion).toMatchObject({
      insertText: 'DisplayName',
      range: {
        startColumn: 3,
        endColumn: 6,
      },
    })
  })

  it('uses bracket notation in top-level data-property shortcuts', () => {
    const suggestion = complete('', [{ label: 'Display Name', path: ['Display Name'] }]).find(
      item => item.label === 'd["Display Name"]'
    )

    expect(suggestion).toMatchObject({
      insertText: 'd["Display Name"]',
    })
  })

  it('preserves periods in literal property names', () => {
    const suggestion = complete('d.Dis', [{ label: 'Display.Name', path: ['Display.Name'] }]).find(
      item => item.label === 'Display.Name'
    )

    expect(suggestion).toMatchObject({
      insertText: '["Display.Name"]',
    })
  })

  it('keeps nested object paths distinct from literal dotted properties', () => {
    const suggestion = complete('d.pro', [
      { label: 'profile.Display Name', path: ['profile', 'Display Name'] },
    ]).find(item => item.label === 'profile.Display Name')

    expect(suggestion).toMatchObject({
      insertText: 'profile["Display Name"]',
    })
  })
})
