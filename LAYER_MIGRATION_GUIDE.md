# Layer Migration Guide

## Status: 8/30 layers migrated

This guide documents how to migrate layer operators to support binary attributes.

## Completed Layers ✅
- ScatterplotLayerOp
- PathLayerOp
- ArcLayerOp
- IconLayerOp
- TextLayerOp
- GeoJsonLayerOp
- PolygonLayerOp

## Pattern to Apply

### Step 1: Add `defaultAttribute` to accessor fields in `createInputs()`:

```typescript
// Before:
getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),

// After:
getPosition: new Point3DField([0, 0, 0], { 
  returnType: 'tuple', 
  accessor: true, 
  defaultAttribute: 'position' 
}),
getFillColor: new ColorField('#fff', { 
  accessor: true, 
  transform: hexToColor, 
  defaultAttribute: 'fillColor' 
}),
```

### Step 2: Update `execute()` method:

```typescript
// Before:
execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
  const layer = {
    ...parseLayerProps<XLayerProps>(props),
    type: 'XLayer' as const,
    id: this.id,
    updateTriggers: gatherTriggers(this.inputs, props),
  }
  return { layer }
}

// After:
execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
  const { rows, attributes } = extractAttributeData(props.data)

  const baseLayerProps = {
    ...parseLayerProps<XLayerProps>({ ...props, data: rows }),
    type: 'XLayer' as const,
    id: this.id,
    updateTriggers: gatherTriggers(this.inputs, props),
  }

  const layerProps = applyBinaryAttributes(baseLayerProps, attributes)

  return { layer: layerProps }
}
```

## Remaining Layers to Migrate

### High Priority (Most Commonly Used):
1. ✅ ScatterplotLayerOp - DONE
2. ✅ PathLayerOp - DONE  
3. ✅ ArcLayerOp - DONE
4. ✅ IconLayerOp - DONE
5. ✅ TextLayerOp - DONE
6. ✅ GeoJsonLayerOp - DONE
7. ✅ PolygonLayerOp - DONE
8. H3HexagonLayerOp - accessor fields: getHexagon, getFillColor, getElevation
9. ColumnLayerOp - accessor fields: getPosition, getFillColor, getLineColor, getElevation, getRadius
10. HeatmapLayerOp - accessor fields: getPosition, getWeight

### Medium Priority:
11. TripsLayerOp - accessor fields: getPath, getTimestamps, getColor, getWidth
12. LineLayerOp - accessor fields: getSourcePosition, getTargetPosition, getColor, getWidth
13. SolidPolygonLayerOp - accessor fields: getPolygon, getFillColor, getElevation
14. GridLayerOp - accessor fields: getPosition, getColorWeight, getElevationWeight
15. HexagonLayerOp - accessor fields: getPosition, getColorWeight, getElevationWeight
16. GridCellLayerOp - accessor fields: getPosition, getColor, getElevation
17. PointCloudLayerOp - accessor fields: getPosition, getColor, getNormal
18. ContourLayerOp - accessor fields: getPosition, getWeight
19. ScreenGridLayerOp - accessor fields: getPosition, getWeight

### Lower Priority (Specialized):
20. GreatCircleLayerOp - accessor fields: getSourcePosition, getTargetPosition, getSourceColor, getTargetColor, getWidth
21. H3ClusterLayerOp - accessor fields: getHexagons, getFillColor
22. ScenegraphLayerOp - accessor fields: getPosition, getOrientation, getScale, getTranslation, getColor
23. SimpleMeshLayerOp - accessor fields: getPosition, getOrientation, getScale, getTranslation, getColor
24. BitmapLayerOp - No accessor fields (just image rendering)
25. Tile3DLayerOp - No accessor fields (tiled 3D content)
26. TileLayerOp - No accessor fields (tile rendering)
27. GeohashLayerOp - accessor fields: getGeohash, getFillColor
28. S2LayerOp - accessor fields: getS2Token, getFillColor
29. QuadkeyLayerOp - accessor fields: getQuadkey, getFillColor
30. A5LayerOp - accessor fields: getA5, getFillColor

## Testing Requirements

For each migrated layer, update or add tests in `/src/noodles/attribute-system.test.ts`:

```typescript
it('should use binary attributes with XLayerOp', () => {
  const data = [/* test data */]
  
  // Create attributes
  const attrOp = new CreateAttributeOp('/test/attr')
  attrOp.createListeners()
  attrOp.inputs.data.setValue(data)
  attrOp.inputs.name.setValue('position') // or relevant attribute
  attrOp.inputs.source.setValue('expression')
  attrOp.inputs.expression.setValue('[d.x, d.y, 0]') // or relevant expression
  attrOp.inputs.size.setValue(3) // or relevant size
  
  const attrResult = attrOp.execute(attrOp.data)
  
  // Create layer
  const layerOp = new XLayerOp('/test/layer')
  layerOp.createListeners()
  layerOp.inputs.data.setValue(attrResult.data)
  
  const layerResult = layerOp.execute(layerOp.data)
  
  // Verify binary attributes are used
  expect(layerResult.layer.getPosition).toHaveProperty('values')
  expect(layerResult.layer.getPosition).toHaveProperty('size')
})
```

## Attribute Name Mapping

The `applyBinaryAttributes()` helper automatically maps attribute names to layer props:

| Attribute Name | Layer Prop Name |
|----------------|----------------|
| position | getPosition |
| sourcePosition | getSourcePosition |
| targetPosition | getTargetPosition |
| fillColor | getFillColor |
| lineColor | getLineColor |
| color | getColor |
| sourceColor | getSourceColor |
| targetColor | getTargetColor |
| radius | getRadius |
| width | getWidth |
| lineWidth | getLineWidth |
| elevation | getElevation |
| size | getSize |
| angle | getAngle |
| path | getPath |
| timestamps | getTimestamps |
| polygon | getPolygon |
| hexagon | getHexagon |
| weight | getWeight |

## Migration Checklist

For each layer:
- [ ] Add `defaultAttribute` to all accessor fields in `createInputs()`
- [ ] Update `execute()` to use `extractAttributeData()` and `applyBinaryAttributes()`
- [ ] Add or update tests in `attribute-system.test.ts`
- [ ] Run tests: `npm test src/noodles/attribute-system.test.ts`
- [ ] Update example projects if they use this layer

## Example Projects to Update

After migrating layers, update these example projects:
- `/public/examples/nyc-taxis/noodles.json`
- `/public/examples/*/noodles.json`

Replace AccessorOp patterns with CreateAttributeOp + binary attributes.
