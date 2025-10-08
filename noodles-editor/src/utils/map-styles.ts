const CARTO_BASEMAPS = [
  {
    name: 'Streets',
    url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    name: 'Light',
    url: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
  },
  {
    name: 'Dark',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    name: 'Dark-NoLabels',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
  },
  {
    name: 'Voyager',
    url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  {
    name: 'Voyager-NoLabels',
    url: 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json',
  },
]

export const CARTO_DARK = CARTO_BASEMAPS[3].url

export const MAP_STYLES = [...CARTO_BASEMAPS].reduce(
  (acc, { url, name }) => {
    acc[url] = name
    return acc
  },
  {} as { [key: string]: string }
)
