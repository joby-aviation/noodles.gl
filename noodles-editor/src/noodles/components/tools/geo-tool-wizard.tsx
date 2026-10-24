import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { besideNetwork, commitBuilt } from '../../../editor/doc-builder'
import { useEngineState } from '../../../editor/doc-engine'
import { docStore, useEditor } from '../../../editor/doc-store'
import { sourceOptions as docSourceOptions, recipeDoc } from '../../../editor/tool-docs'
import { analytics } from '../../../utils/analytics'
import {
  decodeSourceRef,
  defaultValuesFor,
  encodeSourceRef,
  type GeoRecipe,
  type SourceRef,
} from './geo-recipes'
import s from './geo-tool-wizard.module.css'

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

export function GeoToolWizard({ recipe, onOpenChange }: GeoToolWizardProps) {
  const doc = useEditor(st => st.doc)
  const engine = useEngineState()

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

  // Every table in the document, features (a geom column) first, so the user can wire the new
  // node into their graph without hunting for ports
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const hasGeometry = (id: string, port: string) => {
      const ir = engine.lowered?.outputs[id]?.[port]
      return !!ir && !!engine.program?.nodes[ir]?.columns?.some(c => c.name === 'geom')
    }
    return docSourceOptions(doc, hasGeometry).map(o => ({
      value: encodeSourceRef(o.value),
      label: o.geometry ? o.label : `${o.label} (rows)`,
    }))
  }, [doc, engine.lowered, engine.program])

  const rendererId = useMemo(() => doc.nodes.find(n => n.op === 'deck')?.id ?? null, [doc])

  const setParam = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleCreate = useCallback(() => {
    if (!recipe) return
    const resolvedSources: Record<string, SourceRef | null> = {}
    for (const input of recipe.inputs) {
      const raw = sources[input.key]
      resolvedSources[input.key] = raw ? decodeSourceRef(raw) : null
    }
    try {
      const { doc: current, network } = docStore().get()
      const built = recipeDoc({
        doc: current,
        network,
        basePosition: besideNetwork(current, network),
        recipe,
        values,
        sources: resolvedSources,
        addLayer: addLayer && recipe.layerable,
      })
      commitBuilt(docStore(), built)
      analytics.track('gis_tool_created', {
        recipe: recipe.id,
        addLayer,
        wiredInputs: Object.values(resolvedSources).filter(Boolean).length,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create nodes')
    }
  }, [recipe, values, sources, addLayer, onOpenChange])

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
                  Also draw it
                  {rendererId ? ' in the deck' : ' in a new deck'}
                </span>
              </button>
            </div>
          )}

          <div className={s.outcome}>
            <i className="pi pi-info-circle" />
            <span>
              Creates a <strong>{recipe.name}</strong> node
              {addLayer && recipe.layerable ? ' and the layers that draw it' : ''}. It stays
              selected afterwards, so you can tweak these values in the parameter pane, or keyframe
              them in the timeline.
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
