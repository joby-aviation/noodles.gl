import * as Dialog from '@radix-ui/react-dialog'
import * as Accordion from '@radix-ui/react-accordion'
import { Cross2Icon, ChevronDownIcon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, type OnMount } from '@monaco-editor/react'
import { DataTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { analytics } from '../../utils/analytics'
import { getOp } from '../store'
import { duckDbInstance } from '../operators'
import { mustacheRe } from '../fields'
import s from './sql-notebook-dialog.module.css'

interface StatementResult {
  statementIndex: number
  sql: string
  status: 'pending' | 'executing' | 'success' | 'error'
  data?: unknown[]
  rowCount?: number
  executionTime?: number
  error?: string
}

interface NotebookSession {
  sqlContent: string
  results: StatementResult[]
  isExecuting: boolean
}

interface SqlNotebookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSql: string
  operatorId: string
  onCommit: (sql: string) => void
}

function parseSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `${s};`)
}

async function executeAllStatements(
  queryString: string,
  contextOpId: string
): Promise<Array<{ sql: string; data: unknown[]; executionTime: number; error?: string }>> {
  const queries = parseSqlStatements(queryString)
  if (!queries.length) return []

  const db = await duckDbInstance
  const conn = await db.connect()
  const results: Array<{ sql: string; data: unknown[]; executionTime: number; error?: string }> = []

  for (const query of queries) {
    const startTime = performance.now()
    try {
      if (!mustacheRe.test(query)) {
        const result = await conn.query(query)
        results.push({
          sql: query,
          data: result.toArray(),
          executionTime: performance.now() - startTime,
        })
        continue
      }

      const references: Array<{ opId: string; inOut: string; fieldPath: string }> = []
      const parameterizedQuery = query.replace(mustacheRe, (_raw, opId, inOut, fieldPath) => {
        references.push({ opId: opId.startsWith('/') ? opId : `./${opId}`, inOut, fieldPath })
        return `$${references.length}`
      })

      const positionalParams = references.map(({ opId, inOut, fieldPath }) => {
        const op = getOp(opId, contextOpId)
        const [firstKey, ...rest] = fieldPath.split('.')
        const field = op?.[inOut === 'par' ? 'inputs' : 'outputs']?.[firstKey]
        if (!field) throw new Error(`Field ${firstKey} not found on ${opId}`)
        return rest.reduce(
          (d: unknown, prop: string) => (d as Record<string, unknown>)[prop],
          field.value
        )
      })

      const prepared = await conn.prepare(parameterizedQuery)
      const result = await prepared.query(...positionalParams)
      results.push({
        sql: query,
        data: result.toArray(),
        executionTime: performance.now() - startTime,
      })
    } catch (error) {
      results.push({
        sql: query,
        data: [],
        executionTime: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await conn.close()
  return results
}

function getStatusIcon(status: StatementResult['status']): string {
  switch (status) {
    case 'success':
      return '✓'
    case 'error':
      return '✗'
    case 'executing':
      return '⏳'
    default:
      return '○'
  }
}

function getStatusColor(status: StatementResult['status']): string {
  switch (status) {
    case 'success':
      return '#22c55e'
    case 'error':
      return '#ef4444'
    case 'executing':
      return '#f59e0b'
    default:
      return '#888'
  }
}

export function SqlNotebookDialog({
  open,
  onOpenChange,
  initialSql,
  operatorId,
  onCommit,
}: SqlNotebookDialogProps) {
  const [session, setSession] = useState<NotebookSession>({
    sqlContent: initialSql,
    results: [],
    isExecuting: false,
  })
  const [hasExecuted, setHasExecuted] = useState(false)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  // Reset session when dialog opens with new SQL
  useEffect(() => {
    if (open) {
      setSession({
        sqlContent: initialSql,
        results: [],
        isExecuting: false,
      })
      setHasExecuted(false)
    }
  }, [open, initialSql])

  const executeAll = useCallback(async () => {
    const statements = parseSqlStatements(session.sqlContent)

    if (!statements.length) {
      return
    }

    setHasExecuted(true)

    // Initialize all statements as pending
    setSession(prev => ({
      ...prev,
      isExecuting: true,
      results: statements.map((sql, i) => ({
        statementIndex: i,
        sql,
        status: 'pending',
      })),
    }))

    try {
      const results = await executeAllStatements(session.sqlContent, operatorId)

      // Update results with execution data
      setSession(prev => ({
        ...prev,
        isExecuting: false,
        results: results.map((result, i) => ({
          statementIndex: i,
          sql: result.sql,
          status: result.error ? 'error' : 'success',
          data: result.data,
          rowCount: result.data.length,
          executionTime: result.executionTime,
          error: result.error,
        })),
      }))

      const successCount = results.filter(r => !r.error).length
      const errorCount = results.filter(r => r.error).length
      const totalTime = results.reduce((sum, r) => sum + r.executionTime, 0)

      analytics.track('sql_notebook_executed', {
        statementCount: results.length,
        successCount,
        errorCount,
        totalExecutionTime: totalTime,
      })
    } catch (error) {
      console.error('Error executing statements:', error)
      setSession(prev => ({
        ...prev,
        isExecuting: false,
      }))
    }
  }, [session.sqlContent, operatorId])

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor

      // Cmd+Enter to execute
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        executeAll()
      })

      // Escape to close
      editor.addCommand(monaco.KeyCode.Escape, () => {
        onOpenChange(false)
      })
    },
    [executeAll, onOpenChange]
  )

  const handleCommit = useCallback(() => {
    onCommit(session.sqlContent)
    analytics.track('sql_notebook_committed', {
      statementCount: parseSqlStatements(session.sqlContent).length,
    })
    onOpenChange(false)
  }, [session.sqlContent, onCommit, onOpenChange])

  const handleCancel = useCallback(() => {
    analytics.track('sql_notebook_cancelled', {
      hadChanges: session.sqlContent !== initialSql,
    })
    onOpenChange(false)
  }, [session.sqlContent, initialSql, onOpenChange])

  const successCount = session.results.filter(r => r.status === 'success').length
  const errorCount = session.results.filter(r => r.status === 'error').length

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>SQL Notebook</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Execute multi-statement SQL and review results. Changes are not saved until you commit.
          </Dialog.Description>

          {/* Editor Section */}
          <div className={s.editorSection}>
            <div className={s.editorToolbar}>
              <button
                type="button"
                className={s.runButton}
                onClick={executeAll}
                disabled={session.isExecuting}
              >
                {session.isExecuting ? (
                  <>
                    <i className="pi pi-spin pi-spinner" style={{ marginRight: '0.5rem' }} />
                    Executing...
                  </>
                ) : (
                  <>
                    <i className="pi pi-play" style={{ marginRight: '0.5rem' }} />
                    Run All
                  </>
                )}
              </button>
              <span className={s.shortcutHint}>Cmd+Enter to execute</span>
            </div>
            <div className={s.editorContainer}>
              <Editor
                height="100%"
                language="sql"
                theme="vs-dark"
                value={session.sqlContent}
                onChange={value => setSession(prev => ({ ...prev, sqlContent: value || '' }))}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </div>
          </div>

          {/* Results Section */}
          <div className={s.resultsSection}>
            {!hasExecuted ? (
              <div className={s.emptyState}>
                <i className="pi pi-database" style={{ fontSize: '3rem', opacity: 0.3 }} />
                <p>Execute queries to see results</p>
              </div>
            ) : (
              <Accordion.Root
                type="multiple"
                defaultValue={session.results.map((_, i) => `item-${i}`)}
                className={s.accordion}
              >
                {session.results.map((result, index) => (
                  <Accordion.Item
                    key={`${result.statementIndex}-${result.sql}`}
                    value={`item-${index}`}
                    className={s.accordionItem}
                  >
                    <Accordion.Header className={s.accordionHeader}>
                      <Accordion.Trigger className={s.accordionTrigger}>
                        <span className={s.statementBadge}>{index + 1}</span>
                        <span
                          className={s.statusIcon}
                          style={{ color: getStatusColor(result.status) }}
                        >
                          {getStatusIcon(result.status)}
                        </span>
                        <span className={s.sqlPreviewText}>
                          {result.sql.substring(0, 100)}
                          {result.sql.length > 100 ? '...' : ''}
                        </span>
                        {result.status === 'success' && (
                          <span className={s.statementStats}>
                            {result.rowCount} rows • {result.executionTime?.toFixed(0)}ms
                          </span>
                        )}
                        {result.status === 'error' && (
                          <span className={s.statementStats} style={{ color: '#ef4444' }}>
                            Error
                          </span>
                        )}
                        <ChevronDownIcon className={s.chevron} />
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content className={s.accordionContent}>
                      <div className={s.sqlCodeBlock}>
                        <code>{result.sql}</code>
                      </div>
                      {result.error ? (
                        <div className={s.errorMessage}>
                          <i
                            className="pi pi-exclamation-circle"
                            style={{ marginRight: '0.5rem' }}
                          />
                          {result.error}
                        </div>
                      ) : result.data && result.data.length > 0 ? (
                        <div className={s.dataTableContainer}>
                          <DataTable
                            value={result.data.slice(0, 1000)}
                            size="small"
                            resizableColumns
                            showGridlines
                            stripedRows
                            scrollable
                            scrollHeight="300px"
                            paginator
                            rows={50}
                            rowsPerPageOptions={[25, 50, 100]}
                          >
                            {Object.keys(result.data[0] || {}).map(col => (
                              <Column key={col} field={col} header={col} sortable />
                            ))}
                          </DataTable>
                          {result.data.length > 1000 && (
                            <div className={s.truncationWarning}>
                              <i className="pi pi-info-circle" style={{ marginRight: '0.5rem' }} />
                              Showing first 1000 rows of {result.rowCount} total
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={s.emptyResult}>
                          <i className="pi pi-check-circle" style={{ marginRight: '0.5rem' }} />
                          Query executed successfully (0 rows returned)
                        </div>
                      )}
                    </Accordion.Content>
                  </Accordion.Item>
                ))}
              </Accordion.Root>
            )}
          </div>

          {/* Footer */}
          <div className={s.footer}>
            <div className={s.footerStats}>
              {hasExecuted && (
                <>
                  {session.results.length} statements
                  {successCount > 0 && <> • {successCount} succeeded</>}
                  {errorCount > 0 && <> • {errorCount} failed</>}
                </>
              )}
            </div>
            <div className={s.buttonGroup}>
              <button type="button" className={s.cancelButton} onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="button"
                className={s.commitButton}
                onClick={handleCommit}
                disabled={session.isExecuting}
              >
                Commit Query
              </button>
            </div>
          </div>

          <Dialog.Close asChild>
            <button type="button" className={s.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
