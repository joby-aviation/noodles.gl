# Layer Migration Guide

## Status: 30/30 layers migrated ✅

This guide documents how to migrate layer operators to support binary attributes.

## All Layers Migrated ✅

All 30 Deck.gl layer operators have been successfully migrated to support binary attributes:

### High Priority Layers
- ScatterplotLayerOp
- PathLayerOp
- ArcLayerOp
- IconLayerOp
- TextLayerOp
- GeoJsonLayerOp
- PolygonLayerOp
- H3HexagonLayerOp
- ColumnLayerOp
- HeatmapLayerOp

### Medium Priority Layers
- TripsLayerOp
- LineLayerOp
- SolidPolygonLayerOp
- GridLayerOp
- HexagonLayerOp
- GridCellLayerOp
- PointCloudLayerOp
- ContourLayerOp
- ScreenGridLayerOp

### Specialized Layers
- GreatCircleLayerOp
- H3ClusterLayerOp
- ScenegraphLayerOp
- SimpleMeshLayerOp
- BitmapLayerOp (no accessor fields)
- Tile3DLayerOp (no accessor fields)
- TileLayerOp (no accessor fields)
- GeohashLayerOp
- S2LayerOp
- QuadkeyLayerOp
- A5LayerOp

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

## Migration Complete

All Deck.gl layer operators with accessor fields have been migrated. The three layers without accessor fields (BitmapLayerOp, Tile3DLayerOp, TileLayerOp) do not require migration as they don't accept dynamic data attributes.

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
