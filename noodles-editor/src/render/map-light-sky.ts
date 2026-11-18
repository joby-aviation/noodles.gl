// Applies MaplibreBasemapOp's light and sky to the map imperatively, so changing them doesn't
// reload the style. A style load (the first one, or a new mapStyle) replaces the map's light
// and sky with the style's own, so they are applied again on every 'style.load'.

import type { LightSpecification, Map as MapLibre, SkySpecification } from 'maplibre-gl'
import { debugRender } from '../utils/debug'

export interface BasemapLight {
  anchor: 'map' | 'viewport'
  azimuthal: number
  polar: number
}

export interface BasemapSky {
  enabled: boolean
  skyColor: string
  horizonColor: string
  skyHorizonBlend: number
  atmosphereBlend: number
}

type LightSkyMap = Pick<MapLibre, 'setLight' | 'setSky' | 'getLight' | 'getSky' | 'on' | 'off'>

/**
 * Sets the map's light and sky. With no sky configured the map's own (the style's `sky`) is
 * left alone; a sky configured and disabled turns it off.
 */
export function applyLightAndSky(
  map: LightSkyMap,
  light: BasemapLight | undefined,
  sky: BasemapSky | undefined
) {
  // setLight and setSky throw while a style is loading. 'style.load' applies them once it is done.
  try {
    // Note: light settings only apply to globe projection
    if (light) {
      map.setLight({
        anchor: light.anchor,
        position: [1.15, light.azimuthal, light.polar],
      })
    }

    if (sky?.enabled) {
      // Note: skyColor, horizonColor, skyHorizonBlend only apply to mercator projection
      // Note: atmosphereBlend only applies to globe projection
      map.setSky({
        'sky-color': sky.skyColor,
        'horizon-color': sky.horizonColor,
        'sky-horizon-blend': sky.skyHorizonBlend,
        'atmosphere-blend': sky.atmosphereBlend,
      })
    } else if (sky) {
      // Disable sky - requires MapLibre GL JS 4.6.0+. The types leave out undefined
      map.setSky(undefined as unknown as SkySpecification)
    }
  } catch (e) {
    debugRender('Light and sky wait for the style to load: %o', e)
  }
}

/**
 * Applies now and after every style load. Returns a function that stops listening and puts back
 * what this changed: the style's own sky and light as they were before, so turning Sky or Custom
 * light off shows the style's again (#884).
 */
export function syncLightAndSky(
  map: LightSkyMap,
  light: BasemapLight | undefined,
  sky: BasemapSky | undefined
) {
  // The style's own, read before each apply: a style load replaces them with the new style's
  let saved: { sky?: SkySpecification; light?: LightSpecification } = {}
  const apply = () => {
    try {
      saved = { sky: map.getSky(), light: map.getLight() }
    } catch (e) {
      debugRender('Light and sky wait for the style to load: %o', e)
    }
    applyLightAndSky(map, light, sky)
  }
  apply()
  map.on('style.load', apply)
  return () => {
    map.off('style.load', apply)
    try {
      if (sky) map.setSky((saved.sky ?? undefined) as unknown as SkySpecification)
      if (light && saved.light) map.setLight(saved.light)
    } catch (e) {
      debugRender('Light and sky wait for the style to load: %o', e)
    }
  }
}
