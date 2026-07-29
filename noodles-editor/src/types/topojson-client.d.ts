// Minimal ambient type declarations for topojson-client.
// Uses the GeoJSON namespace provided by @types/geojson.
declare module 'topojson-client' {
  interface Topology {
    type: 'Topology'
    objects: Record<string, TopologyObject>
    arcs: number[][][]
    bbox?: [number, number, number, number]
    transform?: { scale: [number, number]; translate: [number, number] }
  }

  interface TopologyObject {
    type: string
    geometries: TopologyGeometry[]
  }

  interface TopologyGeometry {
    type: string
    id?: string | number
    properties?: Record<string, unknown> | null
    arcs?: number[][][] | number[][] | number[]
  }

  function feature(
    topology: Topology,
    object: TopologyObject
  ): GeoJSON.FeatureCollection | GeoJSON.Feature
}
