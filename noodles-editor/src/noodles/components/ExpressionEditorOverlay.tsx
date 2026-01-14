// Expression Editor Overlay - Shared Monaco editor for expression/accessor fields
// Opens as a floating overlay when clicking on an expression input

import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import s from '../noodles.module.css'
import type { ExpressionContext } from '../utils/expression-context'
import { registerExpressionCompletions } from './expression-completions'

// Monaco editor types - using any since we get the instance at runtime from @monaco-editor/react
// biome-ignore lint/suspicious/noExplicitAny: Monaco editor types come from runtime
type MonacoEditor = any

interface ExpressionEditorOverlayProps {
  value: string
  onChange: (value: string) => void
  onClose: () => void
  context: ExpressionContext
  anchorRect: DOMRect | null
  validationError?: string | null
}

// Shared completion disposable to avoid multiple registrations
let completionDisposable: { dispose: () => void } | null = null

export function ExpressionEditorOverlay({
  value,
  onChange,
  onClose,
  context,
  anchorRect,
  validationError,
}: ExpressionEditorOverlayProps) {
  const editorRef = useRef<MonacoEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef(context)

  // Keep context ref updated for completion provider
  contextRef.current = context

  // Position the overlay near the anchor element
  const overlayStyle = useCallback((): React.CSSProperties => {
    if (!anchorRect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    }

    // Calculate position - prefer below the anchor, but flip if near bottom
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const overlayHeight = 120 // Approximate height
    const overlayWidth = Math.max(400, anchorRect.width + 100)

    let top = anchorRect.bottom + 4
    let left = anchorRect.left

    // Flip above if would go off bottom
    if (top + overlayHeight > viewportHeight - 20) {
      top = anchorRect.top - overlayHeight - 4
    }

    // Adjust horizontal if would go off right edge
    if (left + overlayWidth > viewportWidth - 20) {
      left = viewportWidth - overlayWidth - 20
    }

    // Ensure not negative
    left = Math.max(10, left)
    top = Math.max(10, top)

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${overlayWidth}px`,
      zIndex: 10000,
    }
  }, [anchorRect])

  // Handle editor mount
  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor

      // Register completion provider if not already registered
      if (completionDisposable) {
        completionDisposable.dispose()
      }
      completionDisposable = registerExpressionCompletions(monaco, () => contextRef.current)

      // Focus the editor
      editor.focus()

      // Select all text for easy replacement
      const model = editor.getModel()
      if (model) {
        const fullRange = model.getFullModelRange()
        editor.setSelection(fullRange)
      }

      // Handle Enter key (without modifier) to confirm
      editor.addCommand(monaco.KeyCode.Enter, () => {
        const currentValue = editor.getValue()
        onChange(currentValue)
        onClose()
      })

      // Handle Escape to cancel
      editor.addCommand(monaco.KeyCode.Escape, () => {
        onClose()
      })

      // Note: Tab key is NOT overridden here to allow Monaco's autocomplete to work
      // Users can accept autocomplete suggestions with Tab (standard IDE behavior)
    },
    [onChange, onClose]
  )

  // Handle click outside to close and save
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Save changes before closing
        if (editorRef.current) {
          onChange(editorRef.current.getValue())
        }
        onClose()
      }
    }

    // Add listener after a brief delay to avoid immediate close from the opening click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onChange, onClose])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't dispose completions on unmount - keep for next overlay
    }
  }, [])

  // Use createPortal to render outside of ReactFlow's transformed container
  // This ensures position: fixed works correctly relative to the viewport
  return createPortal(
    <div ref={containerRef} className={s.expressionEditorOverlay} style={overlayStyle()}>
      <div className={s.expressionEditorContent}>
        <Editor
          height="60px"
          defaultLanguage="javascript"
          defaultValue={value}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            renderLineHighlight: 'none',
            contextmenu: false,
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            fixedOverflowWidgets: true,
            acceptSuggestionOnEnter: 'on',
            tabCompletion: 'on',
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
      {validationError && <div className={s.expressionEditorError}>{validationError}</div>}
      <div className={s.expressionEditorHint}>
        Enter to confirm • Escape to cancel • Tab to accept suggestion
      </div>
    </div>,
    document.body
  )
}
