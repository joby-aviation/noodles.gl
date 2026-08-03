import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { analytics } from '../../../utils/analytics'
import type { Operator, OpType } from '../../operators'
import { useNestingStore, useOperatorStore } from '../../store'
import type { NodeJSON } from '../../transform-graph'
import { resolveNodeOverlaps } from '../../utils/node-layout'
import { getBaseName } from '../../utils/path-utils'
import {
  buildRecipe,
  decodeSourceRef,
  defaultValuesFor,
  encodeSourceRef,
  type GeoRecipe,
  type SourceRef,
} from './geo-recipes'
import s from './geo-tool-wizard.module.css'

// Output field types worth offering as a geometry source in the wizard
const GEO_OUTPUT_TYPES = new Set(['geojson', 'data'])

interface SourceOption {
  value: string
  label: string
}

function formatBbox(bbox: number[]): string {
  return bbox.join(', ')
}

function parseNumberList(text: string): number[] {
  return text
    .split(',')
    .map(part => Number.parseFloat(part.trim()))
    .filter(value => !Number.isNaN(value))
}

interface GeoToolWizardProps {
  recipe: GeoRecipe | null
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function GeoToolWizard({ recipe, onOpenChange, reactFlowRef }: GeoToolWizardProps) {
  const reactFlow = useReactFlow()
  const operators = useOperatorStore(state => state.operators)
  const currentContainerId = useNestingStore(state => state.currentContainerId)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [sources, setSources] = useState<Record<string, string>>({})
  const [addLayer, setAddLayer] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever a different recipe is opened
  useEffect(() => {
    if (!recipe) return
    setValues(defaultValuesFor(recipe))
    setSources({})
    setAddLayer(recipe.layerable)
    setError(null)
  }, [recipe])

  // Every existing output that could plausibly carry geometry, so the user can
  // wire the new node into their graph without hunting for handles
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const options: SourceOption[] = []
    for (const [id, op] of operators.entries()) {
      for (const [fieldName, field] of Object.entries(op.outputs)) {
        const fieldType = (field.constructor as unknown as { type?: string }).type
        if (!fieldType || !GEO_OUTPUT_TYPES.has(fieldType)) continue
        options.push({
          value: encodeSourceRef({ source: id, sourceHandle: `out.${fieldName}` }),
          label: `${getBaseName(id) || id} → ${fieldName}`,
        })
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label))
  }, [operators])

  const rendererId = useMemo(() => {
    for (const [id, op] of operators.entries()) {
      if ((op.constructor as typeof Operator).displayName === 'DeckRenderer') return id
    }
    return null
  }, [operators])

  const setParam = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleCreate = useCallback(() => {
    if (!recipe) return

    const pane = reactFlowRef.current?.getBoundingClientRect()
    const basePosition = pane
      ? reactFlow.screenToFlowPosition({
          x: pane.left + pane.width / 3,
          y: pane.top + pane.height / 2,
        })
      : { x: 0, y: 0 }

    const resolvedSources: Record<string, SourceRef | null> = {}
    for (const input of recipe.inputs) {
      const raw = sources[input.key]
      resolvedSources[input.key] = raw ? decodeSourceRef(raw) : null
    }

    try {
      const built = buildRecipe({
        recipe,
        values,
        sources: resolvedSources,
        basePosition,
        containerId: currentContainerId || '/',
        addLayer: addLayer && recipe.layerable,
        rendererId,
      })
      const { edges, primaryNodeId } = built
      const nodes = resolveNodeOverlaps(built.nodes, reactFlow.getNodes())

      reactFlow.addNodes(nodes as NodeJSON<OpType>[])
      if (edges.length > 0) reactFlow.addEdges(edges)

      // Select and frame the parameter node so it is obvious where to make changes
      reactFlow.setNodes(ns => ns.map(n => ({ ...n, selected: n.id === primaryNodeId })))
      requestAnimationFrame(() => {
        reactFlow.fitView({ nodes: [{ id: primaryNodeId }], duration: 300, padding: 0.6 })
      })

      analytics.track('gis_tool_created', {
        recipe: recipe.id,
        addLayer,
        wiredInputs: edges.length,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create nodes')
    }
  }, [
    recipe,
    values,
    sources,
    addLayer,
    rendererId,
    currentContainerId,
    reactFlow,
    reactFlowRef,
    onOpenChange,
  ])

  if (!recipe) return null

  const unwiredInputs = recipe.inputs.filter(input => !sources[input.key])

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>
            <i className={`${recipe.icon} ${s.titleIcon}`} />
            {recipe.name}
          </Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>{recipe.summary}</Dialog.Description>

          {recipe.inputs.length > 0 && (
            <div className={s.section}>
              <div className={s.sectionTitle}>1. Choose inputs</div>
              {sourceOptions.length === 0 && (
                <div className={s.notice}>
                  No data nodes yet. Create the node anyway and connect it later, or import data
                  first.
                </div>
              )}
              {recipe.inputs.map(input => (
                <div key={input.key} className={s.formGroup}>
                  <label className={s.label} htmlFor={`source-${input.key}`}>
                    {input.label}
                  </label>
                  <select
                    id={`source-${input.key}`}
                    className={s.select}
                    value={sources[input.key] ?? ''}
                    onChange={e => setSources(prev => ({ ...prev, [input.key]: e.target.value }))}
                  >
                    <option value="">Leave unconnected</option>
                    {sourceOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {input.hint && <div className={s.hint}>{input.hint}</div>}
                </div>
              ))}
            </div>
          )}

          {recipe.params.length > 0 && (
            <div className={s.section}>
              <div className={s.sectionTitle}>
                {recipe.inputs.length > 0 ? '2. Set parameters' : '1. Set parameters'}
              </div>
              {recipe.params.map(param => {
                const id = `param-${param.key}`
                return (
                  <div key={param.key} className={s.formGroup}>
                    <label className={s.label} htmlFor={id}>
                      {param.label}
                    </label>

                    {param.type === 'number' && (
                      <input
                        id={id}
                        type="number"
                        className={s.input}
                        value={String(values[param.key] ?? param.default)}
                        min={param.min}
                        max={param.max}
                        step={param.step ?? 'any'}
                        onChange={e => setParam(param.key, Number(e.target.value))}
                      />
                    )}

                    {param.type === 'select' && (
                      <select
                        id={id}
                        className={s.select}
                        value={String(values[param.key] ?? param.default)}
                        onChange={e => setParam(param.key, e.target.value)}
                      >
                        {param.options.map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    )}

                    {param.type === 'text' && (
                      <input
                        id={id}
                        type="text"
                        className={s.input}
                        placeholder={param.placeholder}
                        value={String(values[param.key] ?? '')}
                        onChange={e => setParam(param.key, e.target.value)}
                      />
                    )}

                    {param.type === 'boolean' && (
                      <button
                        id={id}
                        type="button"
                        className={`${s.toggle} ${values[param.key] ? s.toggleOn : ''}`}
                        onClick={() => setParam(param.key, !values[param.key])}
                      >
                        {values[param.key] ? 'On' : 'Off'}
                      </button>
                    )}

                    {param.type === 'bbox' && (
                      <input
                        id={id}
                        type="text"
                        className={s.input}
                        placeholder="west, south, east, north"
                        value={formatBbox((values[param.key] as number[]) ?? param.default)}
                        onChange={e => {
                          const parsed = parseNumberList(e.target.value)
                          setParam(param.key, parsed.length === 4 ? parsed : e.target.value)
                        }}
                      />
                    )}

                    {param.type === 'point' && (
                      <input
                        id={id}
                        type="text"
                        className={s.input}
                        placeholder="longitude, latitude"
                        value={formatBbox((values[param.key] as number[]) ?? param.default)}
                        onChange={e => {
                          const parsed = parseNumberList(e.target.value)
                          setParam(param.key, parsed.length === 2 ? parsed : e.target.value)
                        }}
                      />
                    )}

                    {param.type === 'numbers' && (
                      <input
                        id={id}
                        type="text"
                        className={s.input}
                        placeholder="100, 200, 500"
                        value={formatBbox((values[param.key] as number[]) ?? param.default)}
                        onChange={e => setParam(param.key, parseNumberList(e.target.value))}
                      />
                    )}

                    {param.hint && <div className={s.hint}>{param.hint}</div>}
                  </div>
                )
              })}
            </div>
          )}

          {recipe.layerable && (
            <div className={s.section}>
              <div className={s.sectionTitle}>Show on map</div>
              <button
                type="button"
                className={`${s.toggleRow} ${addLayer ? s.toggleRowOn : ''}`}
                onClick={() => setAddLayer(prev => !prev)}
              >
                <i className={addLayer ? 'pi pi-check-square' : 'pi pi-stop'} />
                <span>
                  Also add a GeoJsonLayer
                  {rendererId ? ' wired to the existing renderer' : ' plus a renderer and basemap'}
                </span>
              </button>
            </div>
          )}

          <div className={s.outcome}>
            <i className="pi pi-info-circle" />
            <span>
              Creates a <strong>{recipe.name}</strong> node
              {addLayer && recipe.layerable ? ' and a layer' : ''}. It stays selected afterwards, so
              you can tweak these values on the node itself — or keyframe them in the timeline.
            </span>
          </div>

          {unwiredInputs.length > 0 && (
            <div className={s.warning}>
              {unwiredInputs.length} input{unwiredInputs.length > 1 ? 's' : ''} left unconnected:{' '}
              {unwiredInputs.map(i => i.label).join(', ')}
            </div>
          )}

          {error && <div className={s.error}>{error}</div>}

          <div className={s.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={s.cancelButton}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" className={s.createButton} onClick={handleCreate}>
              Create Nodes
            </button>
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
