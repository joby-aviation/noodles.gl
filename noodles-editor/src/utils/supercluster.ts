// Map clusters for one zoom level, as Supercluster makes them. Each cluster is a point with
// `cluster`, `cluster_id`, `point_count` and `expansion_zoom` (the zoom where it splits apart);
// points in no cluster come back as they went in, whatever their properties hold.

import Supercluster from 'supercluster'

export type SuperclusterOptions = {
  zoom: number
  radius: number
  maxZoom: number
  minPoints: number
}

export function supercluster(
  collection: GeoJSON.FeatureCollection,
  { zoom, radius, maxZoom, minPoints }: SuperclusterOptions
): GeoJSON.FeatureCollection {
  const points = collection.features.filter(
    (f): f is Supercluster.PointFeature<Supercluster.AnyProps> => f.geometry?.type === 'Point'
  )
  const index = new Supercluster({ radius, maxZoom, minPoints }).load(points)
  // Supercluster returns unclustered points as these same objects
  const inputs = new Set<GeoJSON.Feature>(points)
  const features = index.getClusters([-180, -90, 180, 90], Math.floor(zoom)).map(feature => {
    if (inputs.has(feature)) return feature
    const { cluster_id } = feature.properties as Supercluster.ClusterProperties
    return {
      ...feature,
      properties: {
        ...feature.properties,
        expansion_zoom: index.getClusterExpansionZoom(cluster_id),
      },
    }
  })
  return { type: 'FeatureCollection', features }
}
