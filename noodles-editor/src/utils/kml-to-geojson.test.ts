import { describe, expect, it } from 'vitest'
import { kmlToGeoJson } from './kml-to-geojson'

describe('kmlToGeoJson', () => {
  it('should convert a simple KML point to GeoJSON', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>-122.0822035425683,37.42228990140251,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

    const result = kmlToGeoJson(kml)

    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.type).toBe('Point')
    expect(result.features[0].geometry.coordinates).toEqual([
      -122.0822035425683, 37.42228990140251, 0,
    ])
    expect(result.features[0].properties?.name).toBe('Test Point')
  })

  it('should convert a KML LineString to GeoJSON', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Line</name>
      <LineString>
        <coordinates>
          -122.084075,37.4220033612141,0
          -122.085125,37.4220033612141,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`

    const result = kmlToGeoJson(kml)

    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.type).toBe('LineString')
    expect(result.features[0].geometry.coordinates).toHaveLength(2)
    expect(result.features[0].properties?.name).toBe('Test Line')
  })

  it('should convert a KML Polygon to GeoJSON', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Polygon</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -122.084893,37.422571,0
              -122.084906,37.422119,0
              -122.084219,37.422119,0
              -122.084219,37.422571,0
              -122.084893,37.422571,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`

    const result = kmlToGeoJson(kml)

    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.type).toBe('Polygon')
    expect(result.features[0].properties?.name).toBe('Test Polygon')
  })

  it('should handle multiple placemarks', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Point 1</name>
      <Point>
        <coordinates>-122.0822,37.4222,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Point 2</name>
      <Point>
        <coordinates>-122.0823,37.4223,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

    const result = kmlToGeoJson(kml)

    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(2)
    expect(result.features[0].properties?.name).toBe('Point 1')
    expect(result.features[1].properties?.name).toBe('Point 2')
  })

  it('should throw an error for invalid KML', () => {
    const invalidKml = 'This is not valid XML'

    expect(() => kmlToGeoJson(invalidKml)).toThrow('Failed to parse KML')
  })

  it('should handle empty KML document', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
  </Document>
</kml>`

    const result = kmlToGeoJson(kml)

    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(0)
  })
})
