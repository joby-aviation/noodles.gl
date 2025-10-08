import type { Effect } from '@deck.gl/core'

import { _SunLight, AmbientLight, LightingEffect, PostProcessEffect } from '@deck.gl/core'
import { tiltShift, vignette } from '@luma.gl/shadertools'
import { type ISheet, types } from '@theatre/core'
import { useEffect, useMemo, useState } from 'react'
import SunCalc from 'suncalc'
import { rgbaToClearColor, rgbaToColor } from '../utils/color'
import useSheetValue, { type PropsValue } from '../utils/use-sheet-value'

const INITIAL_AMBIENT_STATE = {
  color: types.rgba({ r: 1, g: 1, b: 1, a: 1 }),
  intensity: types.number(2.7),
}

const INITIAL_SUNLIGHT_STATE = {
  color: types.rgba({ r: 1, g: 1, b: 1, a: 1 }),
  intensity: types.number(1),
  shadow: types.boolean(true),
  shadowColor: types.rgba({ r: 0, g: 0, b: 0, a: 0.5 }),
  // http://suncalc.net/#/40.7034,-74.0092,12/2024.06.01/04:38
  timeOfDay: types.number(720, { range: [0, 1440] }),
  date: types.compound({
    year: types.number(2023, { range: [2020, 2030] }),
    // The month as a number between 0 and 11 (January to December)
    month: types.number(5, { range: [0, 11] }),
    day: types.number(1, { range: [1, 31] }),
  }),
}

const INITIAL_VIGNETTE_STATE = {
  enabled: types.boolean(false),
  radius: types.number(0.5, { range: [0, 1] }),
  amount: types.number(0.5, { range: [0, 1] }),
}

const INITIAL_TILT_SHIFT_STATE = {
  enabled: types.boolean(false),
  blurRadius: types.number(15, { range: [0, 50] }),
  gradientRadius: types.number(200, { range: [0, 400] }),
  start: types.compound({
    x: types.number(0, { range: [0, 1] }),
    y: types.number(0, { range: [0, 1] }),
  }),
  end: types.compound({
    x: types.number(1, { range: [0, 1] }),
    y: types.number(1, { range: [0, 1] }),
  }),
}

function getTimestamp(sun: PropsValue<typeof INITIAL_SUNLIGHT_STATE>) {
  const {
    timeOfDay,
    date: { year, month, day },
  } = sun
  const hours = Math.floor(timeOfDay / 60)
  const minutes = timeOfDay % 60
  const date = new Date(Math.floor(year), Math.floor(month), Math.floor(day))
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

function isDaytime(lat: number, lon: number, timestamp: number) {
  const date = new Date(timestamp)
  const { sunrise, sunset } = SunCalc.getTimes(date, lat, lon)
  return date >= sunrise && date <= sunset
}

export function useEffects({
  sheet,
  viewState,
}: {
  sheet: ISheet
  viewState: { latitude: number; longitude: number }
}): Effect[] {
  const { ambientSheet, sunSheet, vignetteSheet, tiltShiftSheet } = useMemo(() => {
    const ambientSheet = sheet?.object('light / ambient', INITIAL_AMBIENT_STATE)
    const sunSheet = sheet?.object('light / sunlight', INITIAL_SUNLIGHT_STATE)

    const vignetteSheet = sheet?.object('effect / vignette', INITIAL_VIGNETTE_STATE)
    const tiltShiftSheet = sheet?.object('effect / tiltShift', INITIAL_TILT_SHIFT_STATE)

    return {
      ambientSheet,
      sunSheet,
      vignetteSheet,
      tiltShiftSheet,
    }
  }, [sheet])

  const ambient = useSheetValue(ambientSheet)
  const sun = useSheetValue(sunSheet)
  const vignetteProps = useSheetValue(vignetteSheet)
  const tiltShiftProps = useSheetValue(tiltShiftSheet)

  const [ambientLight, setAmbientLight] = useState(
    new AmbientLight({
      color: rgbaToColor(ambient.color).slice(0, 3) as number[],
      intensity: ambient.intensity,
    })
  )

  const [sunLight, setSunLight] = useState(
    new _SunLight({
      timestamp: getTimestamp(sun),
      color: rgbaToColor(sun.color).slice(0, 3) as number[],
      intensity: sun.intensity,
      _shadow: sun.shadow,
    })
  )

  const [lightingEffect] = useState(
    new LightingEffect({
      ambientLight,
      sunLight,
    })
  )

  // Example: Update the ambient light's intensity based on some prop
  useEffect(() => {
    setAmbientLight(prevLight => {
      prevLight.color = rgbaToColor(ambient.color).slice(0, 3) as number[]
      prevLight.intensity = ambient.intensity
      return prevLight
    })
  }, [ambient])

  useEffect(() => {
    setSunLight(prevLight => {
      prevLight.timestamp = getTimestamp(sun)
      prevLight.color = rgbaToColor(sun.color).slice(0, 3) as number[]
      // @ts-expect-error private variable
      prevLight._shadow = sun.shadow

      // output uniform shadow during nighttime
      if (isDaytime(viewState.latitude, viewState.longitude, getTimestamp(sun))) {
        console.log('daytime')
        // @ts-expect-error private
        lightingEffect.outputUniformShadow = false
        prevLight.intensity = sun.intensity
      } else {
        console.log('nighttime')
        // @ts-expect-error private
        lightingEffect.outputUniformShadow = true
        prevLight.intensity = 0
      }
      return prevLight
    })
  }, [sun, viewState.latitude, lightingEffect, viewState.longitude])

  useEffect(() => {
    lightingEffect.shadowColor = rgbaToClearColor(sun.shadowColor) as number[]
  }, [sun, lightingEffect])

  const effects = useMemo(() => {
    const effects: Effect[] = [lightingEffect]

    if (tiltShiftProps.enabled) {
      const { enabled: _, start, end, ...restTiltShiftUniforms } = tiltShiftProps
      const tiltShiftUniforms = {
        ...restTiltShiftUniforms,
        start: [start.x, start.y],
        end: [end.x, end.y],
      }
      effects.push(new PostProcessEffect(tiltShift, tiltShiftUniforms))
    }

    if (vignetteProps.enabled) {
      const { enabled: _, ...vignetteUniforms } = vignetteProps
      effects.push(new PostProcessEffect(vignette, vignetteUniforms))
    }

    return effects
  }, [lightingEffect, tiltShiftProps, vignetteProps])

  return effects
}
