import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useState, useRef } from 'react'
import * as turf from '@turf/turf'
import { _CoordinatesGeocoder, _GoogleGeocoder } from '@deck.gl/widgets'
import { analytics } from '../../../utils/analytics'
import { useNestingStore } from '../../store'
import { useKeysStore } from '../../keys-store'
import type { NodeJSON } from '@xyflow/react'
import type { OpType } from '../../operators'
import { nodeId } from '../../utils/id-utils'
import s from './point-wizard-tool.module.css'

// GeoJSON Centroid Geocoder - calculates centroid of GeoJSON features
const GeoJsonCentroidGeocoder = {
  name: 'geojson',
  requiresApiKey: false,
  placeholderLocation: 'Paste GeoJSON or upload file',
  async geocode(input: string): Promise<{ longitude: number; latitude: number } | null> {
    try {
      const geojson = JSON.parse(input)
      const center = turf.centroid(geojson)
      return {
        longitude: center.geometry.coordinates[0],
        latitude: center.geometry.coordinates[1],
      }
    } catch {
      return null
    }
  },
}

// Type definition for geocoders
interface Geocoder {
  name: string
  requiresApiKey: boolean
  placeholderLocation: string
  geocode(
    address: string,
    apiKey?: string
  ): Promise<{ longitude: number; latitude: number } | null>
}

interface PointWizardToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function PointWizardTool({ open, onOpenChange, reactFlowRef }: PointWizardToolProps) {
  const [coordinateInput, setCoordinateInput] = useState('')
  const [selectedGeocoder, setSelectedGeocoder] = useState<string>('google')
  const [error, setError] = useState<string | null>(null)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ description: string; placeId: string }>>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { addNodes, screenToFlowPosition } = useReactFlow()
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const getKey = useKeysStore(state => state.getKey)
  const apiKey = getKey('googleMaps') || ''

  // Available geocoders
  const geocoders: Record<string, Geocoder> = {
    coordinates: _CoordinatesGeocoder as unknown as Geocoder,
    google: _GoogleGeocoder as unknown as Geocoder,
    geojson: GeoJsonCentroidGeocoder,
  }

  const currentGeocoder = geocoders[selectedGeocoder]

  // Google Places Autocomplete
  const fetchSuggestions = useCallback(async (input: string) => {
    if (!input.trim() || !apiKey.trim()) {
      setSuggestions([])
      return
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${apiKey}`
      )
      const data = await response.json()

      if (data.status === 'OK') {
        setSuggestions(
          data.predictions.map((p: { description: string; place_id: string }) => ({
            description: p.description,
            placeId: p.place_id,
          }))
        )
        setShowSuggestions(true)
      } else {
        setSuggestions([])
      }
    } catch (err) {
      console.error('Autocomplete error:', err)
      setSuggestions([])
    }
  }, [apiKey])

  const handleInputChange = useCallback((value: string) => {
    setCoordinateInput(value)
    if (selectedGeocoder === 'google' && value.length > 2) {
      fetchSuggestions(value)
    } else {
      setSuggestions([])
    }
  }, [selectedGeocoder, fetchSuggestions])

  const selectSuggestion = useCallback((description: string) => {
    setCoordinateInput(description)
    setShowSuggestions(false)
    setSuggestions([])
  }, [])

  // Handle file upload for GeoJSON
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setCoordinateInput(content)
    }
    reader.readAsText(file)
  }, [])

  const handleCreatePoint = useCallback(async () => {
    setError(null)

    try {
      const geocoder = geocoders[selectedGeocoder]
      if (!geocoder) {
        setError('Invalid geocoder selected')
        return
      }

      if (geocoder.requiresApiKey && !apiKey.trim()) {
        setError('API key is required for this geocoder')
        return
      }

      setIsGeocoding(true)
      const result = await geocoder.geocode(coordinateInput, apiKey)
      setIsGeocoding(false)

      if (!result) {
        setError('Could not geocode the input. Please check the format.')
        return
      }

      // Position node at center of viewport (same as block library)
      const pane = reactFlowRef.current?.getBoundingClientRect()
      if (!pane) return

      const position = screenToFlowPosition({
        x: pane.left + pane.width / 2,
        y: pane.top + pane.height / 2,
      })

      // Create PointOp node
      const pointId = nodeId('point', currentContainerId || '/')
      const node: NodeJSON<OpType> = {
        id: pointId,
        type: 'PointOp',
        data: {
          inputs: {
            coordinates: [result.longitude, result.latitude],
          },
        },
        position,
      }

      addNodes([node])

      // Close wizard and reset
      onOpenChange(false)
      setCoordinateInput('')
      setError(null)
      setSuggestions([])

      analytics.track('point_created', {
        method: selectedGeocoder,
        source: 'tools_shelf',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create point')
      setIsGeocoding(false)
    }
  }, [
    coordinateInput,
    selectedGeocoder,
    apiKey,
    addNodes,
    screenToFlowPosition,
    reactFlowRef,
    currentContainerId,
    geocoders,
    onOpenChange,
  ])

  const renderInputField = () => {
    if (selectedGeocoder === 'geojson') {
      return (
        <>
          <textarea
            id="coordinates"
            value={coordinateInput}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={currentGeocoder?.placeholderLocation || 'Enter location'}
            rows={6}
            className={s.textarea}
          />
          <div className={s.fileUploadContainer}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.geojson"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className={s.uploadButton}
              onClick={() => fileInputRef.current?.click()}
            >
              <i className="pi pi-upload" />
              Upload GeoJSON File
            </button>
          </div>
        </>
      )
    }

    if (selectedGeocoder === 'google') {
      return (
        <div className={s.autocompleteContainer}>
          <input
            id="coordinates"
            type="text"
            value={coordinateInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder={currentGeocoder?.placeholderLocation || 'Enter location'}
            className={s.input}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className={s.suggestionsDropdown}>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.placeId}
                  className={s.suggestionItem}
                  onClick={() => selectSuggestion(suggestion.description)}
                  onKeyDown={(e) => e.key === 'Enter' && selectSuggestion(suggestion.description)}
                >
                  {suggestion.description}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    // Coordinates geocoder - simple input
    return (
      <input
        id="coordinates"
        type="text"
        value={coordinateInput}
        onChange={(e) => handleInputChange(e.target.value)}
        placeholder={currentGeocoder?.placeholderLocation || 'Enter location'}
        className={s.input}
      />
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Create Point</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Choose a geocoding method and enter location information.
          </Dialog.Description>

          <div className={s.tabSelector}>
            <button
              type="button"
              className={`${s.tab} ${selectedGeocoder === 'google' ? s.tabActive : ''}`}
              onClick={() => {
                setSelectedGeocoder('google')
                setCoordinateInput('')
                setSuggestions([])
              }}
            >
              Search
            </button>
            <button
              type="button"
              className={`${s.tab} ${selectedGeocoder === 'coordinates' ? s.tabActive : ''}`}
              onClick={() => {
                setSelectedGeocoder('coordinates')
                setCoordinateInput('')
                setSuggestions([])
              }}
            >
              Coordinates
            </button>
            <button
              type="button"
              className={`${s.tab} ${selectedGeocoder === 'geojson' ? s.tabActive : ''}`}
              onClick={() => {
                setSelectedGeocoder('geojson')
                setCoordinateInput('')
                setSuggestions([])
              }}
            >
              GeoJSON
            </button>
          </div>

          {currentGeocoder?.requiresApiKey && !apiKey && (
            <div className={s.apiKeyMessage}>
              <i className="pi pi-info-circle" style={{ fontSize: '14px' }} />
              <span>
                Google Maps API key required. Add it in{' '}
                <strong>Settings → API Keys</strong>
              </span>
            </div>
          )}

          <div className={s.formGroup}>
            <label htmlFor="coordinates" className={s.label}>
              Location
            </label>
            {renderInputField()}
          </div>

          {error && <div className={s.error}>{error}</div>}

          <div className={s.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={s.cancelButton}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={s.createButton}
              onClick={handleCreatePoint}
              disabled={
                !coordinateInput.trim() ||
                (currentGeocoder?.requiresApiKey && !apiKey.trim()) ||
                isGeocoding
              }
            >
              {isGeocoding ? 'Geocoding...' : 'Create Point'}
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
