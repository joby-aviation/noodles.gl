export type BasemapCategory = 'street' | 'light' | 'dark' | 'imagery' | 'terrain' | 'artistic'
export type BasemapType = 'vector' | 'raster'

export interface BasemapEntry {
  name: string
  url: string
  provider: string
  category: BasemapCategory
  type: BasemapType
  labels?: boolean
}

export const BASEMAP_CATALOG: BasemapEntry[] = [
  // Carto
  { name: 'Positron', url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', provider: 'Carto', category: 'light', type: 'vector', labels: true },
  { name: 'Positron (No Labels)', url: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json', provider: 'Carto', category: 'light', type: 'vector', labels: false },
  { name: 'Dark Matter', url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', provider: 'Carto', category: 'dark', type: 'vector', labels: true },
  { name: 'Dark Matter (No Labels)', url: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json', provider: 'Carto', category: 'dark', type: 'vector', labels: false },
  { name: 'Voyager', url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json', provider: 'Carto', category: 'street', type: 'vector', labels: true },
  { name: 'Voyager (No Labels)', url: 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json', provider: 'Carto', category: 'street', type: 'vector', labels: false },

  // OpenFreeMap
  { name: 'Positron', url: 'https://tiles.openfreemap.org/styles/positron', provider: 'OpenFreeMap', category: 'light', type: 'vector', labels: true },
  { name: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright', provider: 'OpenFreeMap', category: 'street', type: 'vector', labels: true },
  { name: 'Liberty', url: 'https://tiles.openfreemap.org/styles/liberty', provider: 'OpenFreeMap', category: 'street', type: 'vector', labels: true },
  { name: 'Dark', url: 'https://tiles.openfreemap.org/styles/dark', provider: 'OpenFreeMap', category: 'dark', type: 'vector', labels: true },
  { name: 'Fiord', url: 'https://tiles.openfreemap.org/styles/fiord', provider: 'OpenFreeMap', category: 'dark', type: 'vector', labels: true },

  // Stadia Maps (free tier available)
  { name: 'Alidade Smooth', url: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json', provider: 'Stadia', category: 'light', type: 'vector', labels: true },
  { name: 'Alidade Smooth Dark', url: 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json', provider: 'Stadia', category: 'dark', type: 'vector', labels: true },
  { name: 'Outdoors', url: 'https://tiles.stadiamaps.com/styles/outdoors.json', provider: 'Stadia', category: 'terrain', type: 'vector', labels: true },
  { name: 'OSM Bright', url: 'https://tiles.stadiamaps.com/styles/osm_bright.json', provider: 'Stadia', category: 'street', type: 'vector', labels: true },
  { name: 'Stamen Toner', url: 'https://tiles.stadiamaps.com/styles/stamen_toner.json', provider: 'Stadia', category: 'dark', type: 'vector', labels: true },
  { name: 'Stamen Toner Lite', url: 'https://tiles.stadiamaps.com/styles/stamen_toner_lite.json', provider: 'Stadia', category: 'light', type: 'vector', labels: true },
  { name: 'Stamen Terrain', url: 'https://tiles.stadiamaps.com/styles/stamen_terrain.json', provider: 'Stadia', category: 'terrain', type: 'vector', labels: true },
  { name: 'Stamen Watercolor', url: 'https://tiles.stadiamaps.com/styles/stamen_watercolor.json', provider: 'Stadia', category: 'artistic', type: 'vector', labels: false },

  // Protomaps
  { name: 'Light', url: 'https://tiles.protomaps.com/styles/light.json', provider: 'Protomaps', category: 'light', type: 'vector', labels: true },
  { name: 'Dark', url: 'https://tiles.protomaps.com/styles/dark.json', provider: 'Protomaps', category: 'dark', type: 'vector', labels: true },
  { name: 'White', url: 'https://tiles.protomaps.com/styles/white.json', provider: 'Protomaps', category: 'light', type: 'vector', labels: true },
  { name: 'Black', url: 'https://tiles.protomaps.com/styles/black.json', provider: 'Protomaps', category: 'dark', type: 'vector', labels: false },
  { name: 'Grayscale', url: 'https://tiles.protomaps.com/styles/grayscale.json', provider: 'Protomaps', category: 'light', type: 'vector', labels: true },

  // ESRI (raster XYZ, wrapped as MapLibre style)
  { name: 'World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', provider: 'ESRI', category: 'imagery', type: 'raster', labels: false },
  { name: 'World Topo', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', provider: 'ESRI', category: 'terrain', type: 'raster', labels: true },
  { name: 'World Street', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', provider: 'ESRI', category: 'street', type: 'raster', labels: true },
  { name: 'World Gray Canvas', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', provider: 'ESRI', category: 'light', type: 'raster', labels: false },
  { name: 'World Dark Gray Canvas', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', provider: 'ESRI', category: 'dark', type: 'raster', labels: false },
  { name: 'NatGeo', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', provider: 'ESRI', category: 'street', type: 'raster', labels: true },

  // NASA
  { name: 'Blue Marble', url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/EPSG3857_500m/{z}/{y}/{x}.jpeg', provider: 'NASA', category: 'imagery', type: 'raster', labels: false },
  { name: 'Earth at Night', url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-04-01/EPSG3857_500m/{z}/{y}/{x}.jpeg', provider: 'NASA', category: 'imagery', type: 'raster', labels: false },

  // OpenStreetMap (raster)
  { name: 'Standard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', provider: 'OpenStreetMap', category: 'street', type: 'raster', labels: true },
  { name: 'Topo', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', provider: 'OpenTopoMap', category: 'terrain', type: 'raster', labels: true },
]

export const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'

export const MAP_STYLES = BASEMAP_CATALOG.reduce(
  (acc, { url, name, provider }) => {
    acc[url] = `${provider} ${name}`
    return acc
  },
  {} as { [key: string]: string }
)

export const BASEMAP_PROVIDERS = [...new Set(BASEMAP_CATALOG.map(b => b.provider))]
export const BASEMAP_CATEGORIES: BasemapCategory[] = ['street', 'light', 'dark', 'imagery', 'terrain', 'artistic']

export function rasterUrlToStyle(tileUrl: string): object {
  return {
    version: 8,
    sources: {
      'raster-tiles': {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: 'raster-layer',
        type: 'raster',
        source: 'raster-tiles',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  }
}
