import type { OnMount } from '@monaco-editor/react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Cross2Icon, QuestionMarkCircledIcon } from '@radix-ui/react-icons'
import cx from 'classnames'
import type { ScaleLinear, ScaleOrdinal } from 'd3'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { BasemapGallery } from './basemap-gallery'

const CodeiumEditor = lazyWithReload(() =>
  import('@codeium/react-code-editor').then(m => ({ default: m.CodeiumEditor }))
)

import { Temporal } from 'temporal-polyfill'
import { VectorKeyframeIndicator } from '../../timeline/components/KeyframeIndicator'
import { useTimelineStore } from '../../timeline/timeline-store'
import { analytics } from '../../utils/analytics'
import { lazyWithReload } from '../../utils/stale-chunk'
import {
  categoricalSchemesFixed,
  categoricalSchemesStepped,
  continuousInterpolators,
  renderColorScheme,
} from '../color-schemes'
import {
  type BboxField,
  type BezierCurveField,
  type BooleanField,
  CategoricalColorRampField,
  type CodeField,
  type ColorField,
  type ColorRampField,
  type CompoundPropsField,
  type DateField,
  type Field,
  type FileUrlField,
  type IField,
  ListField,
  type MapStyleField,
  type NumberField,
  Point2DField,
  Point3DField,
  StringLiteralField,
  type Vec2Field,
  type Vec3Field,
} from '../fields'
import { useFileSystemStore } from '../filesystem-store'
import s from '../noodles.module.css'
import { checkAssetExists, getAssetFileHandle, writeAsset } from '../storage'
import { projectScheme } from '../utils/filesystem'
import type { OpId } from '../utils/id-utils'
import { computeRelativePath } from '../utils/path-utils'
import { formatReference, parseReference, type ReferenceFormat } from '../utils/reference-utils'
import { ColorSwatch } from './color-swatch'
import { DraggableNumberInput } from './draggable-number-input'
import { GeocodingDialog } from './geocoding-dialog'
import menuStyles from './menu.module.css'
import { extensionOf } from './tools/import-pipelines'

type InputComponent = React.ComponentType<{
  id: OpId
  field: Field
  disabled: boolean
}>

// Field widgets mark where an edit gesture starts and ends. Edits reach the document through
// the FieldAdapter, whose undo already coalesces a drag into one step, so the marks do nothing.
const GESTURE = { captureStart: () => {}, commitChange: (_message: string) => {} }
const usePropertyHistory = () => GESTURE

export const inputComponents = {
  array: EmptyFieldComponent,
  bbox: BboxFieldComponent,
  'bezier-curve': BezierCurveFieldComponent,
  boolean: BooleanFieldComponent,
  'category-color-ramp': ColorRampComponent,
  color: ColorFieldComponent,
  'color-ramp': ColorRampComponent,
  code: CodeFieldComponent,
  compound: CompoundFieldComponent,
  data: EmptyFieldComponent,
  date: DateFieldComponent,
  effect: EmptyFieldComponent,
  'file-url': FileUrlFieldComponent,
  function: EmptyFieldComponent,
  geojson: EmptyFieldComponent,
  'geopoint-2d': VectorFieldComponent,
  'geopoint-3d': VectorFieldComponent,
  layer: EmptyFieldComponent,
  list: EmptyFieldComponent,
  'map-style': MapStyleFieldComponent,
  number: NumberFieldComponent,
  string: TextFieldComponent,
  'string-literal': TextFieldComponent,
  unknown: EmptyFieldComponent,
  vec2: VectorFieldComponent,
  vec3: VectorFieldComponent,
  vec4: VectorFieldComponent,
  view: EmptyFieldComponent,
  visualization: EmptyFieldComponent,
  widget: EmptyFieldComponent,
} as const as Record<string, InputComponent>

// Guard on accessor callbacks in `setValue`/`useState` for when fields are disconnected
function guardAccessorFallback<V>(value: V): V | (() => V) {
  return typeof value === 'function' ? () => value : value
}

const formatText = (val: unknown) =>
  typeof val === 'function'
    ? 'function'
    : typeof val === 'string'
      ? val
      : JSON.stringify(val, null, 2)

function StringLiteralTypeaheadInput({
  id,
  field,
  value,
  onChange,
  disabled,
  captureStart,
  commitChange,
}: {
  id: OpId
  field: StringLiteralField
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  disabled: boolean
  captureStart: () => void
  commitChange: (message: string) => void
}) {
  const [localValue, setLocalValue] = useState(value)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  useEffect(() => {
    if (suggestionsOpen && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom,
        left: rect.left,
        width: rect.width,
      })
    }
  }, [suggestionsOpen])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)
    const syntheticEvent = {
      ...e,
      currentTarget: { value: newValue } as HTMLTextAreaElement,
      target: { value: newValue } as HTMLTextAreaElement,
    } as React.ChangeEvent<HTMLTextAreaElement>
    onChange(syntheticEvent)
  }

  const onFocus = () => {
    captureStart()
    setSuggestionsOpen(true)
  }

  const onBlur = () => {
    commitChange('Change value')
    setTimeout(() => setSuggestionsOpen(false), 150)
  }

  const onSuggestionSelect = (selectedValue: string) => {
    setLocalValue(selectedValue)
    field.setValue(selectedValue)
    commitChange('Change value')
    setSuggestionsOpen(false)
  }

  const filteredSuggestions = field.choices.filter(
    ({ value: v, label }) =>
      v.toLowerCase().includes(localValue.toLowerCase()) ||
      label.toLowerCase().includes(localValue.toLowerCase())
  )

  const showSuggestions = suggestionsOpen && filteredSuggestions.length > 0
  const suggestionsId = `${id}-suggestions`

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={suggestionsId}
        aria-expanded={showSuggestions}
        className={cx(s.fieldInput, s.fieldInputTypeahead)}
        value={localValue}
        onChange={onInputChange}
        onFocus={onFocus}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="Type or select..."
      />
      {showSuggestions &&
        createPortal(
          <div
            id={suggestionsId}
            role="listbox"
            className={s.stringLiteralSuggestions}
            style={{
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
            }}
          >
            {filteredSuggestions.map(({ value: v, label }) => (
              <div
                key={v}
                role="option"
                tabIndex={-1}
                aria-selected={v === localValue}
                className={cx(s.stringLiteralSuggestion, {
                  [s.stringLiteralSuggestionActive]: v === localValue,
                })}
                onMouseDown={event => {
                  // Keep focus on the input so selecting an option cannot also
                  // trigger the blur commit path.
                  event.preventDefault()
                  onSuggestionSelect(v)
                }}
              >
                {label}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

export function TextFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: Field<IField>
  disabled: boolean
}) {
  const [value, setValue] = useState(formatText(field.value))
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(formatText(newVal))
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const val = e.currentTarget.value
    if (val !== field.value) {
      field.setValue(val)
    }
  }

  let input = null
  if (field instanceof StringLiteralField) {
    const useTypeahead = field.choices.length > 0 && field.freeform

    if (field.displayAs === 'color-scheme') {
      // Get step count for categorical ramps
      const stepCount =
        field.op && 'steps' in field.op.inputs
          ? (field.op.inputs.steps?.value as number | undefined)
          : undefined

      input = (
        <ColorSchemeDropdown
          choices={field.choices}
          value={value}
          onChange={newValue => {
            captureStart()
            field.setValue(newValue)
            commitChange('Change color scheme')
          }}
          disabled={disabled}
          stepCount={stepCount}
        />
      )
    } else if (useTypeahead) {
      input = (
        <StringLiteralTypeaheadInput
          id={id}
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          captureStart={captureStart}
          commitChange={commitChange}
        />
      )
    } else if (field.choices.length > 0) {
      // Select dropdown: capture before + commit after inline since change is atomic
      const onSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        captureStart()
        onChange(e)
        commitChange('Change value')
      }
      input = (
        <select
          id={id}
          className={cx(s.fieldInput, s.fieldInputSelect)}
          value={value}
          onChange={onSelectChange}
          disabled={disabled}
        >
          {field.choices.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )
    } else {
      // No choices - use plain text input
      const lineCount = typeof value === 'string' ? value.split('\n').length : 1
      input = (
        <textarea
          id={id}
          className={cx(s.fieldInput, s.fieldTextarea)}
          title={value}
          value={value}
          onFocus={captureStart}
          onBlur={e => {
            onChange(e)
            commitChange('Change text')
          }}
          onChange={onChange}
          disabled={disabled}
          rows={lineCount}
        />
      )
    }
  } else {
    // Always use textarea - handles both single-line and multiline naturally
    const lineCount = typeof value === 'string' ? value.split('\n').length : 1
    input = (
      <textarea
        id={id}
        className={cx(s.fieldInput, s.fieldTextarea)}
        title={value}
        value={value}
        onFocus={captureStart}
        onBlur={e => {
          onChange(e)
          commitChange('Change text')
        }}
        onChange={onChange}
        disabled={disabled}
        rows={lineCount}
      />
    )
  }

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <div className={s.fieldInputWrapper}>{input}</div>
    </div>
  )
}

function VectorNumberInput({
  keyName,
  value,
  objectKey,
  disabled,
  onChange,
  onCommit,
  onInteractionStart,
}: {
  keyName: string
  value: number
  objectKey: string | number
  disabled: boolean
  onChange: (key: string | number, val: number) => void
  onCommit: () => void
  onInteractionStart?: () => void
}) {
  const handleChange = useCallback(
    (val: number) => {
      onChange(objectKey, val)
    },
    [objectKey, onChange]
  )

  return (
    <div className={s.fieldVectorChannel}>
      <span className={s.fieldLabelVector}>{keyName}</span>
      <DraggableNumberInput
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onCommit={onCommit}
        onInteractionStart={onInteractionStart}
        step={0.1}
        className={cx(s.fieldInput, s.fieldInputVector, s.fieldInputNumber)}
        title={`${keyName}: ${value}`}
        placeholder={keyName}
      />
    </div>
  )
}

export function VectorFieldComponent({
  id,
  field,
  disabled,
  opId,
  fieldName,
  expandTimeline,
}: {
  id: OpId
  field: Vec2Field | Vec3Field | Point2DField | Point3DField
  disabled: boolean
  opId?: string
  fieldName?: string
  expandTimeline?: () => void
}) {
  const [value, setValue] = useState<
    { [key: string]: number } | [number, number] | [number, number, number]
  >(guardAccessorFallback(field.value))
  const [geocodingOpen, setGeocodingOpen] = useState(false)
  const { captureStart, commitChange } = usePropertyHistory()

  const isPointField = field instanceof Point2DField || field instanceof Point3DField
  const isPoint3D = field instanceof Point3DField

  const keys = (field.constructor as typeof Vec2Field).channelKeys ?? Object.keys(value)

  // Track the latest value in a ref for onCommit
  const latestValueRef = useRef(value)
  latestValueRef.current = value

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = useCallback(
    (key: number | keyof typeof keys, val: number) => {
      setValue(prevValue => {
        const updated =
          field.returnType === 'tuple'
            ? prevValue.map((v, i) => (i === key ? val : v))
            : { ...prevValue, [key]: val }
        latestValueRef.current = updated
        return updated
      })
    },
    [field.returnType]
  )

  const onCommit = useCallback(() => {
    field.setValue(latestValueRef.current)
    commitChange('Change value')
  }, [field, commitChange])

  // Get current coordinates for Point fields
  const getCurrentCoordinates = useCallback(() => {
    const currentValue = field.value
    if (field.returnType === 'tuple') {
      return {
        longitude: (currentValue as number[])[0],
        latitude: (currentValue as number[])[1],
      }
    }
    return {
      longitude: (currentValue as { lng: number; lat: number }).lng,
      latitude: (currentValue as { lng: number; lat: number }).lat,
    }
  }, [field])

  // Handle location selection from geocoding dialog
  const handleLocationSelected = useCallback(
    ({ longitude, latitude }: { longitude: number; latitude: number }) => {
      if (field.returnType === 'tuple') {
        // For tuple format, preserve altitude for Point3D
        if (isPoint3D) {
          const currentAlt = (field.value as number[])[2] || 0
          field.setValue([longitude, latitude, currentAlt])
        } else {
          field.setValue([longitude, latitude])
        }
      } else {
        // For object format, preserve altitude for Point3D
        if (isPoint3D) {
          const currentAlt = (field.value as { lng: number; lat: number; alt: number }).alt || 0
          field.setValue({ lng: longitude, lat: latitude, alt: currentAlt })
        } else {
          field.setValue({ lng: longitude, lat: latitude })
        }
      }
      commitChange('Change location')
      setGeocodingOpen(false)
    },
    [field, isPoint3D, commitChange]
  )

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <div id={id} className={cx(s.fieldInputWrapper, s.fieldInputWrapperVector)}>
        {keys.map((key, i) => {
          const objectKey = field.returnType === 'tuple' ? i : key
          return (
            <VectorNumberInput
              key={key}
              keyName={key}
              value={value[objectKey]}
              objectKey={objectKey}
              disabled={disabled}
              onChange={onChange}
              onCommit={onCommit}
              onInteractionStart={captureStart}
            />
          )
        })}
        {isPointField && (
          <Button
            icon="pi pi-map-marker"
            className={s.fieldLookupButton}
            onClick={() => {
              captureStart()
              setGeocodingOpen(true)
            }}
            title="Lookup Location"
            size="small"
            disabled={disabled}
            severity="secondary"
            text
          />
        )}
        {opId && fieldName && (
          <VectorKeyframeIndicator
            opId={opId}
            fieldName={fieldName}
            keys={keys}
            value={value as Record<string | number, number>}
            returnType={field.returnType}
            disabled={disabled}
            onKeyframeAdded={expandTimeline}
          />
        )}
      </div>

      {isPointField && (
        <GeocodingDialog
          open={geocodingOpen}
          onOpenChange={setGeocodingOpen}
          mode="update-field"
          initialValue={getCurrentCoordinates()}
          onLocationSelected={handleLocationSelected}
        />
      )}
    </div>
  )
}

export function CodeFieldComponent({
  field,
  disabled,
}: {
  id: string
  field: CodeField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { captureStart, commitChange } = usePropertyHistory()

  // The editor's height in the parameter pane
  const nodeHeight = 300
  const handleEditorChange = useCallback(
    (value: string | undefined, _event) => {
      if (disabled || value === undefined) return
      field.setValue(value)
    },
    [field, disabled]
  )

  const handleEditorDidMount: OnMount = useCallback(
    (editor, _monaco) => {
      editorRef.current = editor
      editor.layout()
      // Capture property state when user begins editing, commit when they stop
      editor.onDidFocusEditorText(() => captureStart())
      editor.onDidBlurEditorWidget(() => commitChange('Change code'))
    },
    [captureStart, commitChange]
  )

  const handleBeforeMount = useCallback(
    async (monaco: unknown) => {
      // Ensure Overpass QL language is registered before editor mounts
      if (field.language === 'overpass-ql') {
        const { registerOverpassQL } = await import('../languages/register-monaco-languages')
        await registerOverpassQL(monaco as any)
      }
    },
    [field.language]
  )
  // Force layout update on load and when node height changes
  useLayoutEffect(() => {
    if (editorRef.current) {
      editorRef.current.layout()
    }
  }, [])

  useEffect(() => {
    const sub = field.subscribe(_ => {
      setValue(field.value)
    })
    return () => sub.unsubscribe()
  }, [field])

  return (
    <div className={cx(s.fieldWrapper, s.fieldWrapperCode)} ref={containerRef}>
      <div className={s.fieldInputWrapperCodeEditor}>
        <Suspense
          fallback={
            <textarea
              style={{
                width: '100%',
                height: nodeHeight - 80,
                background: '#1e1e1e',
                color: '#d4d4d4',
              }}
              value={value}
              onChange={e => field.setValue(e.target.value)}
            />
          }
        >
          <CodeiumEditor
            language={field.language}
            options={{
              tabSize: 2,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
              automaticLayout: true,
              fixedOverflowWidgets: true,
              scrollbar: {
                vertical: 'visible',
                horizontal: 'visible',
              },
            }}
            theme="vs-dark"
            width="100%"
            height={nodeHeight - 80}
            defaultValue={field.value}
            beforeMount={handleBeforeMount}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
          />
        </Suspense>
      </div>
    </div>
  )
}

const EXT_MIME_MAP: Record<string, string> = {
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
}

// Groups extensions from a comma-separated accept string by MIME type for
// showOpenFilePicker. Unknown extensions fall back to application/octet-stream.
function extToMimeTypes(accept: string): Record<string, `.${string}`[]> {
  const result: Record<string, `.${string}`[]> = {}
  for (const ext of accept.split(',').map(e => e.trim())) {
    const mime = EXT_MIME_MAP[ext] ?? 'application/octet-stream'
    if (!result[mime]) result[mime] = []
    result[mime].push(ext as `.${string}`)
  }
  return result
}

export function FileUrlFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: FileUrlField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value
    if (val !== field.value) {
      setValue(val)
    }
  }

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value
    if (val !== field.value) {
      field.setValue(val)
    }
    commitChange('Change file')
  }

  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ name: string; contents: Blob } | null>(null)

  const onUpload = async () => {
    try {
      await doUpload()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      throw err
    }
  }

  const doUpload = async () => {
    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()

    if (!currentProjectName) {
      throw new Error('No project loaded. Please save or load a project first.')
    }

    const pickerOpts: OpenFilePickerOptions = field.accept
      ? {
          types: [{ description: 'Files', accept: extToMimeTypes(field.accept) }],
          excludeAcceptAllOption: true,
          multiple: false,
        }
      : { multiple: false }

    const [fileHandle] = await window.showOpenFilePicker(pickerOpts)
    const file = await fileHandle.getFile()
    const fileType = extensionOf(file.name) || 'unknown'

    // Read as ArrayBuffer so binary files (e.g. .glb) are preserved
    const buffer = await file.arrayBuffer()
    const contents = new Blob([buffer], { type: file.type })

    const exists = await checkAssetExists(activeStorageType, currentProjectName, file.name)
    if (exists) {
      // If the user picked the exact same file already in the data directory, just use it
      const existingHandle = await getAssetFileHandle(
        activeStorageType,
        currentProjectName,
        file.name
      )
      if (existingHandle && (await fileHandle.isSameEntry(existingHandle))) {
        captureStart()
        field.setValue(projectScheme + file.name)
        setValue(projectScheme + file.name)
        commitChange('Change file')
        analytics.track('file_imported', {
          fileType,
          fileFormat: fileType,
          source: 'field',
          fileSize: file.size,
        })
        return
      }
      captureStart()
      setPendingFile({ name: file.name, contents })
      setReplaceDialogOpen(true)
      return
    }

    const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)
    if (!result.success) {
      analytics.track('file_import_failed', {
        fileType,
        attemptedFormat: fileType,
        reason: 'write_failed',
        source: 'field',
        fileSize: file.size,
      })
      throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
    }

    captureStart()
    field.setValue(projectScheme + file.name)
    setValue(projectScheme + file.name)
    commitChange('Change file')
    analytics.track('file_imported', {
      fileType,
      fileFormat: fileType,
      source: 'field',
      fileSize: file.size,
    })
  }

  const onConfirmReplace = async () => {
    if (!pendingFile) return

    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
    if (!currentProjectName) return

    const fileType = extensionOf(pendingFile.name) || 'unknown'
    const result = await writeAsset(
      activeStorageType,
      currentProjectName,
      pendingFile.name,
      pendingFile.contents
    )
    if (!result.success) {
      analytics.track('file_import_failed', {
        fileType,
        attemptedFormat: fileType,
        reason: 'write_failed',
        source: 'field',
        fileSize: pendingFile.contents.size,
      })
      throw new Error(result.error?.message || `Failed to write file: ${pendingFile.name}`)
    }

    field.setValue(projectScheme + pendingFile.name)
    setValue(projectScheme + pendingFile.name)
    commitChange('Change file')
    setReplaceDialogOpen(false)
    setPendingFile(null)
    analytics.track('file_imported', {
      fileType,
      fileFormat: fileType,
      source: 'field',
      fileSize: pendingFile.contents.size,
    })
  }

  const onCancelReplace = () => {
    setReplaceDialogOpen(false)
    setPendingFile(null)
  }

  return (
    <>
      <div className={cx(s.fieldWrapper, 'nokey')}>
        <FieldLabel id={id} field={field} />
        <div className={cx('p-inputgroup', s.fieldFileInputGroup)}>
          <InputText
            id={id}
            placeholder="https://"
            className={cx(s.fieldInput, s.fieldInputFileUrl)}
            value={value}
            onFocus={captureStart}
            onBlur={onBlur}
            onChange={onChange}
            disabled={disabled}
          />
          <Button
            icon="pi pi-upload"
            className={s.fieldInputUploadButton}
            onClick={onUpload}
            title="Upload File"
            size="small"
          />
        </div>
      </div>

      <Dialog.Root open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            <Dialog.Title className={menuStyles.dialogTitle}>Replace file</Dialog.Title>
            <Dialog.Description className={menuStyles.dialogDescription}>
              A file named "{pendingFile?.name}" already exists. Do you want to replace it?
            </Dialog.Description>
            <div className={menuStyles.dialogRightSlot}>
              <Dialog.Close asChild>
                <button type="button" className={menuStyles.dialogButton} onClick={onCancelReplace}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.red)}
                onClick={onConfirmReplace}
              >
                Replace
              </button>
            </div>
            <Dialog.Close asChild onClick={onCancelReplace}>
              <button type="button" className={menuStyles.dialogIconButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

export function MapStyleFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: MapStyleField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const isObject = typeof value === 'object' && value !== null
  const displayValue = isObject ? '[Style Object]' : value

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value
    if (typeof field.value !== 'object' && val !== field.value) {
      setValue(val)
    }
  }

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value
    if (typeof field.value !== 'object' && val !== field.value) {
      field.setValue(val)
    }
    commitChange('Change map style')
  }

  const [galleryOpen, setGalleryOpen] = useState(false)

  const onGallerySelect = (val: string | object) => {
    captureStart()
    field.setValue(val)
    setValue(typeof val === 'string' ? val : val)
    commitChange('Change map style')
  }

  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ name: string; contents: Blob } | null>(null)

  const onUpload = async () => {
    try {
      await doUpload()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      throw err
    }
  }

  const doUpload = async () => {
    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
    if (!currentProjectName) {
      throw new Error('No project loaded. Please save or load a project first.')
    }

    const pickerOpts: OpenFilePickerOptions = field.accept
      ? {
          types: [{ description: 'Files', accept: extToMimeTypes(field.accept) }],
          excludeAcceptAllOption: true,
          multiple: false,
        }
      : { multiple: false }

    const [fileHandle] = await window.showOpenFilePicker(pickerOpts)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    const contents = new Blob([buffer], { type: file.type })

    const exists = await checkAssetExists(activeStorageType, currentProjectName, file.name)
    if (exists) {
      const existingHandle = await getAssetFileHandle(
        activeStorageType,
        currentProjectName,
        file.name
      )
      if (existingHandle && (await fileHandle.isSameEntry(existingHandle))) {
        captureStart()
        field.setValue(projectScheme + file.name)
        setValue(projectScheme + file.name)
        commitChange('Change map style')
        return
      }
      captureStart()
      setPendingFile({ name: file.name, contents })
      setReplaceDialogOpen(true)
      return
    }

    const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)
    if (!result.success) {
      throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
    }

    captureStart()
    field.setValue(projectScheme + file.name)
    setValue(projectScheme + file.name)
    commitChange('Change map style')
  }

  const onConfirmReplace = async () => {
    if (!pendingFile) return

    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
    if (!currentProjectName) return

    const result = await writeAsset(
      activeStorageType,
      currentProjectName,
      pendingFile.name,
      pendingFile.contents
    )
    if (!result.success) {
      throw new Error(result.error?.message || `Failed to write file: ${pendingFile.name}`)
    }

    field.setValue(projectScheme + pendingFile.name)
    setValue(projectScheme + pendingFile.name)
    commitChange('Change map style')
    setReplaceDialogOpen(false)
    setPendingFile(null)
  }

  const onCancelReplace = () => {
    setReplaceDialogOpen(false)
    setPendingFile(null)
  }

  return (
    <>
      <div className={cx(s.fieldWrapper, 'nokey')}>
        <FieldLabel id={id} field={field} />
        <div className={cx('p-inputgroup', s.fieldFileInputGroup)}>
          <InputText
            id={id}
            placeholder={isObject ? '' : 'https://'}
            className={cx(s.fieldInput, s.fieldInputFileUrl)}
            value={displayValue}
            onFocus={captureStart}
            onBlur={onBlur}
            onChange={onChange}
            disabled={disabled || isObject}
          />
          <Button
            icon="pi pi-images"
            className={s.fieldInputUploadButton}
            onClick={() => setGalleryOpen(true)}
            title="Browse Basemaps"
            size="small"
          />
          <Button
            icon="pi pi-upload"
            className={s.fieldInputUploadButton}
            onClick={onUpload}
            title="Upload File"
            size="small"
            disabled={isObject}
          />
        </div>
      </div>

      <BasemapGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onSelect={onGallerySelect}
        currentValue={typeof value === 'string' ? value : undefined}
      />

      <Dialog.Root open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            <Dialog.Title className={menuStyles.dialogTitle}>Replace file</Dialog.Title>
            <Dialog.Description className={menuStyles.dialogDescription}>
              A file named "{pendingFile?.name}" already exists. Do you want to replace it?
            </Dialog.Description>
            <div className={menuStyles.dialogRightSlot}>
              <Dialog.Close asChild>
                <button type="button" className={menuStyles.dialogButton} onClick={onCancelReplace}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.red)}
                onClick={onConfirmReplace}
              >
                Replace
              </button>
            </div>
            <Dialog.Close asChild onClick={onCancelReplace}>
              <button type="button" className={menuStyles.dialogIconButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

export function NumberFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: NumberField
  disabled: boolean
}) {
  const [value, setValue] = useState<number>(guardAccessorFallback(field.value))
  const [stepOverride, setStepOverride] = useState(field.stepOverride)
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const valueSub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    const stepSub = field.stepOverride$.subscribe(setStepOverride)
    return () => {
      valueSub.unsubscribe()
      stepSub.unsubscribe()
    }
  }, [field])

  const handleChange = useCallback(
    (val: number) => {
      setValue(val)
      field.setValue(val)
    },
    [field]
  )

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <DraggableNumberInput
        id={id}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onCommit={() => commitChange('Change value')}
        onInteractionStart={captureStart}
        onStepChange={step => field.setStepOverride(step)}
        min={field.min}
        max={field.max}
        softMin={field.softMin}
        softMax={field.softMax}
        step={stepOverride ?? field.getEffectiveStep(value)}
        className={cx(s.fieldInput, s.fieldInputNumber)}
        title={value.toString()}
      />
    </div>
  )
}

export function BooleanFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: BooleanField
  disabled: boolean
}) {
  const [value, setValue] = useState<boolean>(guardAccessorFallback(field.value))
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      captureStart()
      field.setValue(e.currentTarget.checked)
      commitChange('Toggle boolean')
    },
    [field, captureStart, commitChange]
  )

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <div className={s.fieldInputWrapper}>
        <input
          id={id}
          className={cx('revert', s.fieldInput, s.fieldInputCheckbox)}
          type="checkbox"
          checked={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

export function DateFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: DateField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Parse the datetime-local input value and create a Temporal.PlainDateTime
    const inputValue = e.currentTarget.value
    if (inputValue) {
      captureStart()
      field.setValue(Temporal.PlainDateTime.from(inputValue))
      commitChange('Change date')
    }
  }

  // Convert Temporal.PlainDateTime to datetime-local format
  // Always show full precision with milliseconds: YYYY-MM-DDTHH:mm:ss.SSS
  const formatted = value?.toString?.()?.substring(0, 23) || ''

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <div className={s.fieldInputWrapper}>
        <input
          id={id}
          type="datetime-local"
          className={cx(s.fieldInput, s.fieldInputDate)}
          value={formatted}
          onChange={onChange}
          disabled={disabled}
          step={0.001}
        />
      </div>
    </div>
  )
}

export function ColorFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: ColorField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))
  const { captureStart, commitChange } = usePropertyHistory()

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const handleColorChange = useCallback(
    (hexColor: string) => {
      field.setValue(hexColor)
    },
    [field]
  )

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <div className={s.fieldInputWrapper}>
        <ColorSwatch
          value={value}
          onChange={handleColorChange}
          disabled={disabled}
          onPickerOpen={captureStart}
          onPickerClose={() => commitChange('Change color')}
        />
      </div>
    </div>
  )
}

function ColorSchemePreview({
  schemeName,
  stepCount = 8,
}: {
  schemeName: string
  stepCount?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderColorScheme(ctx, schemeName, 100, 16, stepCount)
  }, [schemeName, stepCount])

  return <canvas ref={canvasRef} className={s.colorSchemePreviewCanvas} width={100} height={16} />
}

function ColorSchemeDropdown({
  choices,
  value,
  onChange,
  disabled,
  triggerElement,
  stepCount,
}: {
  choices: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  disabled: boolean
  triggerElement?: React.ReactNode
  stepCount?: number
}) {
  const defaultTrigger = (
    <button type="button" className={cx(s.fieldInput, s.fieldInputSelect)} disabled={disabled}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ColorSchemePreview schemeName={value} stepCount={stepCount} />
        <span>{choices.find(c => c.value === value)?.label || value}</span>
      </div>
    </button>
  )

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        {triggerElement || defaultTrigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.colorSchemeDropdownContent} sideOffset={4}>
          {choices.map(choice => (
            <DropdownMenu.Item
              key={choice.value}
              className={s.colorSchemeDropdownItem}
              onSelect={() => onChange(choice.value)}
            >
              <ColorSchemePreview schemeName={choice.value} stepCount={stepCount} />
              <span className={s.colorSchemeName}>{choice.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function ColorRampComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: ColorRampField | CategoricalColorRampField
  disabled: boolean
}) {
  const [interpolate, setInterpolate] = useState<
    ScaleOrdinal<string, string> | ScaleLinear<number, string>
  >(() => field.value)

  // For categorical ramps, get count from the scale's domain length
  // For continuous ramps, use a fixed pixel width
  const steps =
    field instanceof CategoricalColorRampField && 'domain' in interpolate
      ? (interpolate as ScaleOrdinal<string, string>).domain().length
      : 512

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      setInterpolate(() => newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    for (let i = 0; i < steps; ++i) {
      const val = field instanceof CategoricalColorRampField ? `${id}-${i}` : i / (steps - 1)
      ctx.fillStyle = interpolate(val)
      ctx.fillRect(i, 0, 1, 1)
    }
  }, [interpolate, field, id, steps])

  // Check for sibling colorScheme field
  const colorSchemeField = useMemo(() => {
    const op = field.op
    if (!op) return null
    const csField = op.inputs.colorScheme
    return csField instanceof StringLiteralField && csField.displayAs === 'color-scheme'
      ? csField
      : null
  }, [field.op])

  // Get step count for categorical ramps
  const stepCount = useMemo(() => {
    const op = field.op
    if (!op || !('steps' in op.inputs)) return undefined
    return op.inputs.steps?.value as number | undefined
  }, [field.op])

  const { captureStart, commitChange } = usePropertyHistory()

  if (colorSchemeField) {
    // Render clickable canvas with dropdown
    const triggerElement = (
      <button
        type="button"
        className={s.fieldInputColorRampButton}
        disabled={disabled}
        title="Click to change color scheme"
      >
        <canvas ref={canvasRef} className={s.fieldInputColorRamp} width={steps} height={1} />
      </button>
    )

    return (
      <div className={cx(s.fieldWrapper, 'nokey')}>
        <ColorSchemeDropdown
          choices={colorSchemeField.choices}
          value={colorSchemeField.value}
          onChange={newValue => {
            captureStart()
            colorSchemeField.setValue(newValue)
            commitChange('Change color scheme')
          }}
          disabled={disabled}
          triggerElement={triggerElement}
          stepCount={stepCount}
        />
      </div>
    )
  }

  // Fallback: read-only canvas (existing behavior)
  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <canvas
        id={id}
        aria-label={`${id} color ramp`}
        className={s.fieldInputColorRamp}
        ref={canvasRef}
        width={steps}
        height={1}
      />
    </div>
  )
}

// A compound field's member, drawn with its type's widget
function SubField({ id, field, disabled }: { id: string; field: Field; disabled: boolean }) {
  const Input = inputComponents[(field.constructor as typeof Field).type]
  return Input ? <Input id={id} field={field} disabled={disabled} /> : null
}

export function CompoundFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: CompoundPropsField
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <button
        className={s.fieldLabel}
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        title={id}
      >
        {getFieldDocs(id, field, field.op).label}
        <span className={cx(s.compoundPropsExpander, expanded && s.compoundPropsExpanderExpanded)}>
          ►
        </span>
      </button>
      {expanded ? (
        <div id={id} className={s.fieldCompoundWrapper}>
          {Object.entries(field.fields).map(([key, subField]) => (
            <SubField key={key} id={key} field={subField} disabled={disabled} />
          ))}
        </div>
      ) : (
        <button
          className={s.compoundPropsExpander}
          type="button"
          onClick={() => setExpanded(e => !e)}
        >
          ({Object.entries(field.fields).length} hidden props)
        </button>
      )}
    </div>
  )
}

// Node row label: the field's friendly name, with its key (the name used in edges,
// references and expressions) as the tooltip
export function FieldLabel({
  id,
  field,
  as = 'label',
}: {
  id: OpId
  field: Field<IField>
  as?: 'label' | 'div'
}) {
  const { label } = getFieldDocs(id, field, field.op)
  return as === 'label' ? (
    <label className={s.fieldLabel} htmlFor={id} title={id}>
      {label}
    </label>
  ) : (
    <div className={s.fieldLabel} title={id}>
      {label}
    </div>
  )
}

export function EmptyFieldComponent({ id, field }: { id: OpId; field: Field<IField> }) {
  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} as="div" />
    </div>
  )
}

const BEZIER_SVG_SIZE = { width: 200, height: 150 }
const BEZIER_PADDING = { top: 10, right: 10, bottom: 20, left: 20 }
const BEZIER_GRAPH_AREA = {
  width: BEZIER_SVG_SIZE.width - BEZIER_PADDING.left - BEZIER_PADDING.right,
  height: BEZIER_SVG_SIZE.height - BEZIER_PADDING.top - BEZIER_PADDING.bottom,
}

export function BezierCurveFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: BezierCurveField
  disabled: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { captureStart, commitChange } = usePropertyHistory()
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    dragIndex: number
    dragType: 'point' | 'handle-left' | 'handle-right'
    startX: number
    startY: number
  } | null>(null)

  // Convert SVG coordinates to curve coordinates (0-1, 0-1)
  const svgToCurve = useCallback((x: number, y: number) => {
    const curveX = (x - BEZIER_PADDING.left) / BEZIER_GRAPH_AREA.width
    const curveY = 1 - (y - BEZIER_PADDING.top) / BEZIER_GRAPH_AREA.height // Flip Y axis
    return {
      x: Math.max(0, Math.min(1, curveX)),
      y: Math.max(0, Math.min(1, curveY)),
    }
  }, [])

  // Convert curve coordinates to SVG coordinates
  const curveToSvg = useCallback(
    (x: number, y: number) => ({
      x: BEZIER_PADDING.left + x * BEZIER_GRAPH_AREA.width,
      y: BEZIER_PADDING.top + (1 - y) * BEZIER_GRAPH_AREA.height, // Flip Y axis
    }),
    []
  )

  // Generate SVG path for the bezier curve
  const generateCurvePath = useCallback(() => {
    const { points } = field.value
    if (points.length === 0) return ''

    let pathData = ''

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]

      const startPos = curveToSvg(p0.x, p0.y)
      const endPos = curveToSvg(p1.x, p1.y)

      const cp1 = curveToSvg(
        p0.handleRightX ?? p0.x + (p1.x - p0.x) * 0.33,
        p0.handleRightY ?? p0.y
      )
      const cp2 = curveToSvg(p1.handleLeftX ?? p1.x - (p1.x - p0.x) * 0.33, p1.handleLeftY ?? p1.y)

      if (i === 0) {
        pathData += `M ${startPos.x} ${startPos.y} `
      }

      pathData += `C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${endPos.x} ${endPos.y} `
    }

    return pathData
  }, [field.value, curveToSvg])

  // Generate grid lines
  const generateGridLines = useCallback(() => {
    const lines = []

    // Vertical grid lines
    for (let i = 0; i <= 4; i++) {
      const x = BEZIER_PADDING.left + (i / 4) * BEZIER_GRAPH_AREA.width
      lines.push(
        <line
          key={`v-${i}`}
          x1={x}
          y1={BEZIER_PADDING.top}
          x2={x}
          y2={BEZIER_PADDING.top + BEZIER_GRAPH_AREA.height}
          stroke="#333"
          strokeWidth="1"
        />
      )
    }

    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = BEZIER_PADDING.top + (i / 4) * BEZIER_GRAPH_AREA.height
      lines.push(
        <line
          key={`h-${i}`}
          x1={BEZIER_PADDING.left}
          y1={y}
          x2={BEZIER_PADDING.left + BEZIER_GRAPH_AREA.width}
          y2={y}
          stroke="#333"
          strokeWidth="1"
        />
      )
    }

    return lines
  }, [])

  // Find what the user is trying to interact with
  const getInteractionTarget = useCallback(
    (x: number, y: number) => {
      const { points } = field.value

      for (let i = 0; i < points.length; i++) {
        const point = points[i]

        // Check control point
        const pos = curveToSvg(point.x, point.y)
        const distanceToPoint = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2))

        if (distanceToPoint <= 6) {
          return { type: 'point' as const, index: i }
        }

        // Check left handle
        if (point.handleLeftX !== undefined && point.handleLeftY !== undefined) {
          const handlePos = curveToSvg(point.handleLeftX, point.handleLeftY)
          const distanceToHandle = Math.sqrt(
            Math.pow(x - handlePos.x, 2) + Math.pow(y - handlePos.y, 2)
          )

          if (distanceToHandle <= 6) {
            return { type: 'handle-left' as const, index: i }
          }
        }

        // Check right handle
        if (point.handleRightX !== undefined && point.handleRightY !== undefined) {
          const handlePos = curveToSvg(point.handleRightX, point.handleRightY)
          const distanceToHandle = Math.sqrt(
            Math.pow(x - handlePos.x, 2) + Math.pow(y - handlePos.y, 2)
          )

          if (distanceToHandle <= 6) {
            return { type: 'handle-right' as const, index: i }
          }
        }
      }

      return null
    },
    [field.value, curveToSvg]
  )

  // Get mouse position relative to SVG with proper scaling
  const getMousePosition = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }

    // Create an SVG point and use the SVG coordinate transformation
    const point = svg.createSVGPoint()
    point.x = e.clientX
    point.y = e.clientY

    // Transform the point to SVG coordinates
    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse())

    return {
      x: svgPoint.x,
      y: svgPoint.y,
    }
  }, [])

  // Handle mouse events
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) return

      const { x, y } = getMousePosition(e)
      const target = getInteractionTarget(x, y)

      if (target) {
        captureStart()
        setDragState({
          isDragging: true,
          dragIndex: target.index,
          dragType: target.type,
          startX: x,
          startY: y,
        })
      } else {
        // Add new point if clicking on empty space within the graph area
        const curvePos = svgToCurve(x, y)
        if (curvePos.x >= 0 && curvePos.x <= 1 && curvePos.y >= 0 && curvePos.y <= 1) {
          captureStart()
          field.addPoint(curvePos.x, curvePos.y)
          commitChange('Add curve point')
        }
      }
    },
    [
      disabled,
      getInteractionTarget,
      svgToCurve,
      field,
      getMousePosition,
      captureStart,
      commitChange,
    ]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragState?.isDragging) return

      const { x, y } = getMousePosition(e)
      const curvePos = svgToCurve(x, y)

      const { dragIndex, dragType } = dragState

      if (dragType === 'point') {
        field.updatePoint(dragIndex, { x: curvePos.x, y: curvePos.y })
      } else if (dragType === 'handle-left') {
        field.updatePoint(dragIndex, {
          handleLeftX: curvePos.x,
          handleLeftY: curvePos.y,
        })
      } else if (dragType === 'handle-right') {
        field.updatePoint(dragIndex, {
          handleRightX: curvePos.x,
          handleRightY: curvePos.y,
        })
      }
    },
    [dragState, svgToCurve, field, getMousePosition]
  )

  const handleMouseUp = useCallback(() => {
    if (dragState?.isDragging) {
      commitChange('Edit curve')
    }
    setDragState(null)
  }, [dragState, commitChange])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) return

      const { x, y } = getMousePosition(e)
      const target = getInteractionTarget(x, y)

      if (target && target.type === 'point') {
        captureStart()
        // Remove point on double-click
        field.removePoint(target.index)
        commitChange('Remove curve point')
      }
    },
    [disabled, getInteractionTarget, field, getMousePosition, captureStart, commitChange]
  )

  // Handle point selection for showing controls
  const handlePointClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) return

      const { x, y } = getMousePosition(e)
      const target = getInteractionTarget(x, y)

      if (target && target.type === 'point') {
        field.setSelectedPoint(target.index)
      } else {
        field.setSelectedPoint(null)
      }
    },
    [disabled, getInteractionTarget, field, getMousePosition]
  )

  const { points } = field.value
  const selectedPoint = field.getSelectedPoint()
  const selectedIndex = field.selectedPointIndex
  const curvePath = generateCurvePath()
  const gridLines = generateGridLines()

  return (
    <div className={cx(s.fieldWrapper, 'nokey')} ref={containerRef}>
      <FieldLabel id={id} field={field} />
      <div className={s.bezierCurveEditor}>
        <svg
          ref={svgRef}
          width={BEZIER_SVG_SIZE.width}
          height={BEZIER_SVG_SIZE.height}
          viewBox={`0 0 ${BEZIER_SVG_SIZE.width} ${BEZIER_SVG_SIZE.height}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onClick={handlePointClick}
          style={{
            cursor: dragState?.isDragging ? 'grabbing' : 'crosshair',
            border: '1px solid #555',
            borderRadius: '4px',
            backgroundColor: '#1a1a1a',
            display: 'block',
            maxWidth: '100%',
            height: 'auto',
          }}
          aria-label="Bezier curve editor"
        >
          <title>Bezier curve editor</title>
          {/* Background */}
          <rect width={BEZIER_SVG_SIZE.width} height={BEZIER_SVG_SIZE.height} fill="#1a1a1a" />

          {/* Grid */}
          {gridLines}

          {/* Border */}
          <rect
            x={BEZIER_PADDING.left}
            y={BEZIER_PADDING.top}
            width={BEZIER_GRAPH_AREA.width}
            height={BEZIER_GRAPH_AREA.height}
            fill="none"
            stroke="#555"
            strokeWidth="1"
          />

          {/* Curve path */}
          {curvePath && <path d={curvePath} fill="none" stroke="#ffffff" strokeWidth="2" />}

          {/* Control points and handles */}
          {points.map((point, index) => {
            const pos = curveToSvg(point.x, point.y)
            const isSelected = selectedIndex === index

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: Bezier curve points don't have stable IDs
              <g key={index}>
                {/* Left handle */}
                {point.handleLeftX !== undefined && point.handleLeftY !== undefined && (
                  <g>
                    <line
                      x1={pos.x}
                      y1={pos.y}
                      x2={curveToSvg(point.handleLeftX, point.handleLeftY).x}
                      y2={curveToSvg(point.handleLeftX, point.handleLeftY).y}
                      stroke="#888"
                      strokeWidth="1"
                    />
                    <circle
                      cx={curveToSvg(point.handleLeftX, point.handleLeftY).x}
                      cy={curveToSvg(point.handleLeftX, point.handleLeftY).y}
                      r="3"
                      fill="#888"
                    />
                  </g>
                )}

                {/* Right handle */}
                {point.handleRightX !== undefined && point.handleRightY !== undefined && (
                  <g>
                    <line
                      x1={pos.x}
                      y1={pos.y}
                      x2={curveToSvg(point.handleRightX, point.handleRightY).x}
                      y2={curveToSvg(point.handleRightX, point.handleRightY).y}
                      stroke="#888"
                      strokeWidth="1"
                    />
                    <circle
                      cx={curveToSvg(point.handleRightX, point.handleRightY).x}
                      cy={curveToSvg(point.handleRightX, point.handleRightY).y}
                      r="3"
                      fill="#888"
                    />
                  </g>
                )}

                {/* Control point */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="4"
                  fill={isSelected ? '#ff8800' : '#ffffff'}
                  stroke={isSelected ? '#ffffff' : 'none'}
                  strokeWidth={isSelected ? '1' : '0'}
                />
              </g>
            )
          })}
        </svg>

        {/* Active point controls */}
        {selectedPoint && selectedIndex !== null && (
          <div
            className="bezier-point-controls"
            style={{
              marginTop: '8px',
              padding: '6px',
              backgroundColor: '#2a2a2a',
              borderRadius: '4px',
              border: '1px solid #555',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
            }}
          >
            {/* Position controls */}
            <input
              type="number"
              title="X Position"
              value={selectedPoint.x.toFixed(4)}
              onChange={e => {
                const newX = parseFloat(e.target.value)
                if (!Number.isNaN(newX)) {
                  field.updatePoint(selectedIndex, { x: newX })
                }
              }}
              style={{
                width: '50px',
                padding: '2px 4px',
                fontSize: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
              }}
              step="0.0001"
              min="0"
              max="1"
              disabled={disabled}
            />
            <input
              type="number"
              title="Y Position"
              value={selectedPoint.y.toFixed(4)}
              onChange={e => {
                const newY = parseFloat(e.target.value)
                if (!Number.isNaN(newY)) {
                  field.updatePoint(selectedIndex, { y: newY })
                }
              }}
              style={{
                width: '50px',
                padding: '2px 4px',
                fontSize: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
              }}
              step="0.0001"
              min="0"
              max="1"
              disabled={disabled}
            />

            {/* Handle type toggle group */}
            <div
              style={{
                display: 'flex',
                border: '1px solid #555',
                borderRadius: '3px',
                overflow: 'hidden',
                marginLeft: '8px',
              }}
            >
              {[
                { value: 'auto', icon: '○', title: 'Auto' },
                { value: 'vector', icon: '▶', title: 'Vector' },
                { value: 'auto-clamped', icon: '─', title: 'Auto Clamped' },
                { value: 'free', icon: '●', title: 'Free' },
              ].map(handleType => {
                const isLeftSelected =
                  selectedPoint.handleLeftType === handleType.value ||
                  (!selectedPoint.handleLeftType && handleType.value === 'free')
                const isRightSelected =
                  selectedPoint.handleRightType === handleType.value ||
                  (!selectedPoint.handleRightType && handleType.value === 'free')
                const isSelected = isLeftSelected && isRightSelected

                return (
                  <button
                    key={handleType.value}
                    type="button"
                    title={`${handleType.title} Handle`}
                    onClick={() => {
                      field.updateHandleType(
                        selectedIndex,
                        'left',
                        handleType.value as 'auto' | 'vector' | 'auto-clamped' | 'free'
                      )
                      field.updateHandleType(
                        selectedIndex,
                        'right',
                        handleType.value as 'auto' | 'vector' | 'auto-clamped' | 'free'
                      )
                    }}
                    style={{
                      padding: '3px 6px',
                      fontSize: '10px',
                      backgroundColor: isSelected ? '#555' : '#333',
                      border: 'none',
                      color: isSelected ? '#fff' : '#aaa',
                      cursor: disabled ? 'default' : 'pointer',
                      minWidth: '20px',
                    }}
                    disabled={disabled}
                  >
                    {handleType.icon}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className={s.bezierHelp}>
          <button
            type="button"
            className={cx(s.bezierHelpButton, 'nodrag')}
            aria-label={`${isHelpOpen ? 'Hide' : 'Show'} Bézier curve help`}
            aria-controls={`${id}-bezier-help`}
            aria-expanded={isHelpOpen}
            title="Bézier curve help"
            onClick={() => setIsHelpOpen(open => !open)}
          >
            <QuestionMarkCircledIcon aria-hidden="true" />
          </button>
          {isHelpOpen && (
            <div id={`${id}-bezier-help`} className={s.bezierHelpPopover} role="note">
              Click to add a point. Click a point to select it. Double-click to remove it. Drag to
              move it.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Normalize bbox value to object format for internal use
function normalizeBboxValue(val: any) {
  if (Array.isArray(val)) {
    // Tuple format: [[lng, lat], [lng, lat]] or [{lng, lat}, {lng, lat}]
    const sw = Array.isArray(val[0]) ? { lng: val[0][0], lat: val[0][1] } : val[0]
    const ne = Array.isArray(val[1]) ? { lng: val[1][0], lat: val[1][1] } : val[1]
    return { southwest: sw, northeast: ne }
  }
  return val
}

export function BboxFieldComponent({
  id,
  field,
  disabled,
  opId,
  fieldName,
  expandTimeline,
}: {
  id: OpId
  field: BboxField
  disabled: boolean
  opId?: string
  fieldName?: string
  expandTimeline?: () => void
}) {
  const [value, setValue] = useState<{
    southwest: { lng: number; lat: number }
    northeast: { lng: number; lat: number }
  }>(normalizeBboxValue(guardAccessorFallback(field.value)))
  const [geocodingOpen, setGeocodingOpen] = useState(false)
  const [geocodingCorner, setGeocodingCorner] = useState<'southwest' | 'northeast'>('southwest')
  const { captureStart, commitChange } = usePropertyHistory()

  // Track the latest value in a ref for onCommit
  const latestValueRef = useRef(value)
  latestValueRef.current = value

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(normalizeBboxValue(newVal))
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = useCallback(
    (corner: 'southwest' | 'northeast', coord: 'lng' | 'lat', val: number) => {
      setValue(prevValue => {
        const updated = {
          ...prevValue,
          [corner]: {
            ...prevValue[corner],
            [coord]: val,
          },
        }
        latestValueRef.current = updated
        return updated
      })
    },
    []
  )

  const onCommit = useCallback(() => {
    field.setValue(latestValueRef.current)
    commitChange('Change bbox')
  }, [field, commitChange])

  // Handle location selection from geocoding dialog
  const handleLocationSelected = useCallback(
    ({ longitude, latitude }: { longitude: number; latitude: number }) => {
      setValue(prevValue => {
        const updated = {
          ...prevValue,
          [geocodingCorner]: { lng: longitude, lat: latitude },
        }
        field.setValue(updated)
        return updated
      })
      commitChange('Change bbox corner')
      setGeocodingOpen(false)
    },
    [field, geocodingCorner, commitChange]
  )

  return (
    <div className={cx(s.fieldWrapper, 'nokey')}>
      <FieldLabel id={id} field={field} />
      <div id={id} className={s.fieldCompoundWrapper}>
        <div className={s.fieldGroupLabel}>Southwest</div>
        <div className={cx(s.fieldInputWrapper, s.fieldInputWrapperVector)}>
          <VectorNumberInput
            keyName="lng"
            value={value.southwest.lng}
            objectKey="lng"
            disabled={disabled}
            onChange={(_, val) => onChange('southwest', 'lng', val)}
            onCommit={onCommit}
            onInteractionStart={captureStart}
          />
          <VectorNumberInput
            keyName="lat"
            value={value.southwest.lat}
            objectKey="lat"
            disabled={disabled}
            onChange={(_, val) => onChange('southwest', 'lat', val)}
            onCommit={onCommit}
            onInteractionStart={captureStart}
          />
          <Button
            icon="pi pi-map-marker"
            className={s.fieldLookupButton}
            onClick={() => {
              captureStart()
              setGeocodingCorner('southwest')
              setGeocodingOpen(true)
            }}
            title="Lookup Southwest Corner"
            size="small"
            disabled={disabled}
            severity="secondary"
            text
          />
        </div>

        <div className={cx(s.fieldGroupLabel, s.fieldGroupLabelSpaced)}>Northeast</div>
        <div className={cx(s.fieldInputWrapper, s.fieldInputWrapperVector)}>
          <VectorNumberInput
            keyName="lng"
            value={value.northeast.lng}
            objectKey="lng"
            disabled={disabled}
            onChange={(_, val) => onChange('northeast', 'lng', val)}
            onCommit={onCommit}
            onInteractionStart={captureStart}
          />
          <VectorNumberInput
            keyName="lat"
            value={value.northeast.lat}
            objectKey="lat"
            disabled={disabled}
            onChange={(_, val) => onChange('northeast', 'lat', val)}
            onCommit={onCommit}
            onInteractionStart={captureStart}
          />
          <Button
            icon="pi pi-map-marker"
            className={s.fieldLookupButton}
            onClick={() => {
              captureStart()
              setGeocodingCorner('northeast')
              setGeocodingOpen(true)
            }}
            title="Lookup Northeast Corner"
            size="small"
            disabled={disabled}
            severity="secondary"
            text
          />
        </div>
      </div>

      <GeocodingDialog
        open={geocodingOpen}
        onOpenChange={setGeocodingOpen}
        mode="update-field"
        initialValue={
          geocodingCorner === 'southwest'
            ? { longitude: value.southwest.lng, latitude: value.southwest.lat }
            : { longitude: value.northeast.lng, latitude: value.northeast.lat }
        }
        onLocationSelected={handleLocationSelected}
      />
    </div>
  )
}
