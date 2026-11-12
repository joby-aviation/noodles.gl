// Applies MaplibreBasemapOp's light and sky to the map imperatively, so changing them doesn't
// reload the style. A style load (the first one, or a new mapStyle) replaces the map's light
// and sky with the style's own, so they are applied again on every 'style.load'.

import type { Map as MapLibre, SkySpecification } from 'maplibre-gl'
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

type LightSkyMap = Pick<MapLibre, 'setLight' | 'setSky' | 'on' | 'off'>

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
    } else {
      // Disable sky - requires MapLibre GL JS 4.6.0+. The types leave out undefined
      map.setSky(undefined as unknown as SkySpecification)
    }
  } catch (e) {
    debugRender('Light and sky wait for the style to load: %o', e)
  }
}

// Applies now and after every style load. Returns a function that stops listening.
export function syncLightAndSky(
  map: LightSkyMap,
  light: BasemapLight | undefined,
  sky: BasemapSky | undefined
) {
  const apply = () => applyLightAndSky(map, light, sky)
  apply()
  map.on('style.load', apply)
  return () => {
    map.off('style.load', apply)
  }
}
