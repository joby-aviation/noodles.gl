import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useState } from 'react'
import s from './measure-tool.module.css'

type MeasureMode = 'distance' | 'area'
type DistanceUnit = 'kilometers' | 'miles' | 'meters' | 'nauticalmiles'

interface Point {
  id: number
  lat: number
  lng: number
}

let pointCounter = 0

function haversineDistance(p1: Point, p2: Point): number {
  const R = 6371
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0
  const R = 6371
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    const lat1 = (points[i].lat * Math.PI) / 180
    const lat2 = (points[j].lat * Math.PI) / 180
    const dLng = ((points[j].lng - points[i].lng) * Math.PI) / 180
    total += dLng * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  return Math.abs((total * R * R) / 2)
}

function convertDistance(km: number, unit: DistanceUnit): number {
  switch (unit) {
    case 'kilometers':
      return km
    case 'miles':
      return km * 0.621371
    case 'meters':
      return km * 1000
    case 'nauticalmiles':
      return km * 0.539957
  }
}

function formatDistance(value: number, unit: DistanceUnit): string {
  if (value < 0.01) return `${(value * 1000).toFixed(1)} ${unit === 'meters' ? 'mm' : 'm'}`
  if (value > 1000 && unit === 'meters') return `${(value / 1000).toFixed(2)} km`
  return `${value.toFixed(2)} ${unit}`
}

function formatArea(sqKm: number): string {
  if (sqKm < 1) return `${(sqKm * 1_000_000).toFixed(0)} m²`
  if (sqKm > 1000) return `${(sqKm / 1_000_000).toFixed(4)} million km²`
  return `${sqKm.toFixed(2)} km²`
}

interface MeasureToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MeasureTool({ open, onOpenChange }: MeasureToolProps) {
  const [mode, setMode] = useState<MeasureMode>('distance')
  const [unit, setUnit] = useState<DistanceUnit>('kilometers')
  const [points, setPoints] = useState<Point[]>([])
  const [inputLat, setInputLat] = useState('')
  const [inputLng, setInputLng] = useState('')

  const addPoint = useCallback(() => {
    const lat = Number.parseFloat(inputLat)
    const lng = Number.parseFloat(inputLng)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return
    setPoints(prev => [...prev, { id: ++pointCounter, lat, lng }])
    setInputLat('')
    setInputLng('')
  }, [inputLat, inputLng])

  const removePoint = useCallback((index: number) => {
    setPoints(prev => prev.filter((_, i) => i !== index))
  }, [])

  const clearAll = useCallback(() => {
    setPoints([])
    setInputLat('')
    setInputLng('')
  }, [])

  const totalDistance = points.reduce((sum, point, i) => {
    if (i === 0) return 0
    return sum + haversineDistance(points[i - 1], point)
  }, 0)

  const area = polygonArea(points)
  const displayDistance = convertDistance(totalDistance, unit)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Measure</Dialog.Title>

          <div className={s.modeToggle}>
            <button
              type="button"
              className={`${s.modeButton} ${mode === 'distance' ? s.modeActive : ''}`}
              onClick={() => setMode('distance')}
            >
              <i className="pi pi-arrows-h" />
              Distance
            </button>
            <button
              type="button"
              className={`${s.modeButton} ${mode === 'area' ? s.modeActive : ''}`}
              onClick={() => setMode('area')}
            >
              <i className="pi pi-stop" />
              Area
            </button>
          </div>

          {mode === 'distance' && (
            <div className={s.unitRow}>
              <select
                className={s.unitSelect}
                value={unit}
                onChange={e => setUnit(e.target.value as DistanceUnit)}
              >
                <option value="kilometers">Kilometers</option>
                <option value="miles">Miles</option>
                <option value="meters">Meters</option>
                <option value="nauticalmiles">Nautical Miles</option>
              </select>
            </div>
          )}

          <div className={s.pointInput}>
            <input
              type="number"
              className={s.coordInput}
              placeholder="Latitude"
              value={inputLat}
              onChange={e => setInputLat(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addPoint()
              }}
              step="any"
            />
            <input
              type="number"
              className={s.coordInput}
              placeholder="Longitude"
              value={inputLng}
              onChange={e => setInputLng(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addPoint()
              }}
              step="any"
            />
            <button type="button" className={s.addButton} onClick={addPoint}>
              Add
            </button>
          </div>

          {points.length > 0 && (
            <div className={s.pointsList}>
              {points.map((point, i) => (
                <div key={point.id} className={s.pointItem}>
                  <span className={s.pointIndex}>{i + 1}</span>
                  <span className={s.pointCoords}>
                    {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                  </span>
                  {i > 0 && mode === 'distance' && (
                    <span className={s.segmentDistance}>
                      +
                      {formatDistance(
                        convertDistance(haversineDistance(points[i - 1], point), unit),
                        unit
                      )}
                    </span>
                  )}
                  <button type="button" className={s.removeButton} onClick={() => removePoint(i)}>
                    <i className="pi pi-times" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={s.result}>
            {mode === 'distance' && points.length >= 2 && (
              <div className={s.resultValue}>
                <span className={s.resultLabel}>Total Distance</span>
                <span className={s.resultNumber}>{formatDistance(displayDistance, unit)}</span>
              </div>
            )}
            {mode === 'area' && points.length >= 3 && (
              <div className={s.resultValue}>
                <span className={s.resultLabel}>Area</span>
                <span className={s.resultNumber}>{formatArea(area)}</span>
              </div>
            )}
            {((mode === 'distance' && points.length < 2) ||
              (mode === 'area' && points.length < 3)) && (
              <div className={s.resultHint}>
                Add {mode === 'distance' ? 'at least 2 points' : 'at least 3 points'} to measure
              </div>
            )}
          </div>

          <div className={s.dialogActions}>
            <button type="button" className={s.clearButton} onClick={clearAll}>
              Clear All
            </button>
            <Dialog.Close asChild>
              <button type="button" className={s.closeDialogButton}>
                Close
              </button>
            </Dialog.Close>
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
