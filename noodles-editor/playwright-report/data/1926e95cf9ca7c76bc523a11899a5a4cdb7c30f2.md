# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: examples-visual-regression.spec.ts >> Example Projects Visual Regression >> nyc-taxis renders correctly
- Location: src/__tests__/examples-visual-regression.spec.ts:48:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e5]:
    - generic [ref=e6]:
      - button "Noodles.gl" [ref=e7] [cursor=pointer]:
        - img "Noodles.gl" [ref=e9]
        - img [ref=e10]
      - generic [ref=e12]:
        - button "NYC Taxis" [ref=e13] [cursor=pointer]
        - button / [ref=e14]
    - generic [ref=e15]:
      - button " Add Op" [ref=e16] [cursor=pointer]:
        - generic [ref=e17]: 
        - generic [ref=e18]: Add Op
      - button " Create Point" [ref=e19] [cursor=pointer]:
        - generic [ref=e20]: 
        - generic [ref=e21]: Create Point
      - button " Import Data" [ref=e22] [cursor=pointer]:
        - generic [ref=e23]: 
        - generic [ref=e24]: Import Data
    - generic [ref=e25]:
      - button " External Control" [ref=e26] [cursor=pointer]:
        - generic [ref=e27]: 
        - generic [ref=e28]: External Control
      - button " Assistant" [ref=e29] [cursor=pointer]:
        - generic [ref=e30]: 
        - text: Assistant
  - button "" [ref=e31] [cursor=pointer]:
    - generic [ref=e32]: 
  - generic [ref=e36]:
    - generic [ref=e38]: Page
    - generic [ref=e39]: Select a node to see properties
  - button "Timeline" [ref=e41] [cursor=pointer]:
    - img [ref=e42]
    - generic [ref=e44]: Timeline
  - generic [ref=e45]:
    - generic [ref=e48]:
      - region "Map" [ref=e49]
      - group [ref=e50]:
        - generic "Toggle attribution" [ref=e51] [cursor=pointer]
        - generic [ref=e52]:
          - link "MapLibre" [ref=e53] [cursor=pointer]:
            - /url: https://maplibre.org/
          - text: "| ©"
          - link "CARTO" [ref=e54] [cursor=pointer]:
            - /url: https://carto.com/about-carto/
          - text: ", ©"
          - link "OpenStreetMap" [ref=e55] [cursor=pointer]:
            - /url: http://www.openstreetmap.org/about/
          - text: contributors
    - application [ref=e59]:
      - generic [ref=e61]:
        - generic:
          - generic:
            - img:
              - group "Edge from /deck to /out" [ref=e62] [cursor=pointer]
            - img:
              - group "Edge from /data-source to /source-position" [ref=e67] [cursor=pointer]
            - img:
              - group "Edge from /source-position to /target-position" [ref=e72] [cursor=pointer]
            - img:
              - group "Edge from /target-position to /arc-layer" [ref=e77] [cursor=pointer]
            - img:
              - group "Edge from /target-position to /pickup-layer" [ref=e82] [cursor=pointer]
            - img:
              - group "Edge from /target-position to /dropoff-layer" [ref=e87] [cursor=pointer]
            - img:
              - group "Edge from /maplibre-basemap to /deck" [ref=e92] [cursor=pointer]
            - img:
              - group "Edge from /arc-layer to /deck" [ref=e97] [cursor=pointer]
            - img:
              - group "Edge from /pickup-layer to /deck" [ref=e102] [cursor=pointer]
            - img:
              - group "Edge from /dropoff-layer to /deck" [ref=e107] [cursor=pointer]
            - img:
              - group "Edge from /blending to /pickup-layer" [ref=e112] [cursor=pointer]
            - img:
              - group "Edge from /blending to /arc-layer" [ref=e117] [cursor=pointer]
            - img:
              - group "Edge from /blending to /dropoff-layer" [ref=e122] [cursor=pointer]
            - img:
              - group "Edge from /pickup to /arc-layer" [ref=e127] [cursor=pointer]
            - img:
              - group "Edge from /pickup to /pickup-layer" [ref=e132] [cursor=pointer]
            - img:
              - group "Edge from /dropoff to /arc-layer" [ref=e137] [cursor=pointer]
            - img:
              - group "Edge from /dropoff to /dropoff-layer" [ref=e142] [cursor=pointer]
          - generic:
            - group [ref=e147]:
              - generic [ref=e148]:
                - generic [ref=e149]:
                  - generic "/data-source (File)" [ref=e150]:
                    - button "data-source" [ref=e151]
                    - text: (File)
                  - generic "Executed in 132.1ms" [ref=e152]:
                    - generic [ref=e153]: 
                  - generic [ref=e154]:
                    - button "" [ref=e155]:
                      - generic: 
                    - button "" [ref=e156]:
                      - generic: 
                - generic [ref=e157]:
                  - generic [ref=e160]:
                    - generic [ref=e161]: format
                    - combobox "format" [ref=e163]:
                      - option "json"
                      - option "csv" [selected]
                      - option "tsv"
                      - option "text"
                      - option "binary"
                  - generic [ref=e166]:
                    - generic [ref=e167]: url
                    - generic [ref=e168]:
                      - textbox "url" [ref=e169]:
                        - /placeholder: https://
                        - text: "@/data.csv"
                      - button "" [ref=e170] [cursor=pointer]:
                        - generic: 
                  - generic [ref=e173]:
                    - generic [ref=e174]: text
                    - textbox "text" [ref=e176]
                  - generic [ref=e179]:
                    - generic [ref=e180]: autoType
                    - checkbox "autoType" [checked] [ref=e182] [cursor=pointer]
                  - generic [ref=e185]:
                    - generic [ref=e186]: pulse
                    - group [ref=e187]:
                      - spinbutton "pulse" [ref=e188]: "0"
            - group [ref=e190]:
              - generic [ref=e191]:
                - generic [ref=e192]:
                  - generic "/maplibre-basemap (MaplibreBasemap)" [ref=e193]:
                    - button "maplibre-basemap" [ref=e194]
                    - text: (MaplibreBasemap)
                  - button "" [ref=e196]:
                    - generic: 
                - generic [ref=e197]:
                  - generic [ref=e200]:
                    - generic [ref=e201]: mapStyle
                    - generic [ref=e202]:
                      - textbox "mapStyle" [ref=e203]:
                        - /placeholder: https://
                        - text: https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
                      - button "" [ref=e204] [cursor=pointer]:
                        - generic: 
                  - generic [ref=e207]:
                    - button "viewState ►" [expanded] [ref=e208]:
                      - text: viewState
                      - generic [ref=e209] [cursor=pointer]: ►
                    - generic [ref=e210]:
                      - generic [ref=e212]:
                        - generic [ref=e213]: latitude
                        - group [ref=e214]:
                          - spinbutton "latitude" [ref=e215]: "40.74"
                      - generic [ref=e217]:
                        - generic [ref=e218]: longitude
                        - group [ref=e219]:
                          - spinbutton "longitude" [ref=e220]: "-73.98"
                      - generic [ref=e222]:
                        - generic [ref=e223]: zoom
                        - group [ref=e224]:
                          - spinbutton "zoom" [ref=e225]: "12.09"
                      - generic [ref=e227]:
                        - generic [ref=e228]: pitch
                        - group [ref=e229]:
                          - spinbutton "pitch" [ref=e230]: "56"
                      - generic [ref=e232]:
                        - generic [ref=e233]: bearing
                        - group [ref=e234]:
                          - spinbutton "bearing" [ref=e235]: "-15.25"
            - group [ref=e237]:
              - generic [ref=e238]:
                - generic [ref=e239]:
                  - generic "/pickup (Color)" [ref=e240]:
                    - button "pickup" [ref=e241]
                    - text: (Color)
                  - button "" [ref=e243]:
                    - generic: 
                - generic [ref=e247]:
                  - generic [ref=e248]: color
                  - button "Open color picker" [ref=e250] [cursor=pointer]
            - group [ref=e253]:
              - generic [ref=e254]:
                - generic [ref=e255]:
                  - generic "/dropoff (Color)" [ref=e256]:
                    - button "dropoff" [ref=e257]
                    - text: (Color)
                  - button "" [ref=e259]:
                    - generic: 
                - generic [ref=e263]:
                  - generic [ref=e264]: color
                  - button "Open color picker" [ref=e266] [cursor=pointer]
            - group [ref=e269]:
              - generic [ref=e270]:
                - generic [ref=e271]:
                  - generic "/blending (Blending)" [ref=e272]:
                    - button "blending" [ref=e273]
                    - text: (Blending)
                  - button "" [ref=e275]:
                    - generic: 
                - generic [ref=e279]:
                  - generic [ref=e280]: mode
                  - combobox "mode" [ref=e282]:
                    - option "normal"
                    - option "additive" [selected]
                    - option "subtractive"
                    - option "custom"
            - group [ref=e284]:
              - generic [ref=e285]:
                - generic [ref=e286]:
                  - generic "/source-position (Create Attribute)" [ref=e287]:
                    - button "source-position" [ref=e288]
                    - text: (Create Attribute)
                  - button "" [ref=e290]:
                    - generic: 
                - generic [ref=e291]:
                  - generic [ref=e295]: data
                  - generic [ref=e298]:
                    - generic [ref=e299]: name
                    - textbox "name name" [ref=e301]: sourcePosition
                  - generic [ref=e304]:
                    - generic [ref=e305]: expression
                    - textbox "expression expression" [ref=e307] [cursor=pointer]:
                      - /placeholder: Click to edit expression...
                      - text: "[d.pickup_longitude, d.pickup_latitude, 0]"
                  - generic [ref=e310]:
                    - generic [ref=e311]: outputType
                    - combobox "outputType outputType" [ref=e313]:
                      - option "number" [selected]
                      - option "string"
                      - option "boolean"
                  - generic [ref=e316]:
                    - generic [ref=e317]: type
                    - combobox "type type" [ref=e319]:
                      - option "float" [selected]
                      - option "uint8"
                      - option "int32"
                  - generic [ref=e322]:
                    - generic [ref=e323]: size
                    - group [ref=e324]:
                      - spinbutton "size size" [ref=e325]: "3"
            - group [ref=e327]:
              - generic [ref=e328]:
                - generic [ref=e329]:
                  - generic "/target-position (Create Attribute)" [ref=e330]:
                    - button "target-position" [ref=e331]
                    - text: (Create Attribute)
                  - button "" [ref=e333]:
                    - generic: 
                - generic [ref=e334]:
                  - generic [ref=e338]: data
                  - generic [ref=e341]:
                    - generic [ref=e342]: name
                    - textbox "targetPosition" [ref=e344]
                  - generic [ref=e347]:
                    - generic [ref=e348]: expression
                    - textbox "[d.dropoff_longitude, d.dropoff_latitude, 0]" [ref=e350] [cursor=pointer]:
                      - /placeholder: Click to edit expression...
                  - generic [ref=e353]:
                    - generic [ref=e354]: outputType
                    - combobox [ref=e356]:
                      - option "number" [selected]
                      - option "string"
                      - option "boolean"
                  - generic [ref=e359]:
                    - generic [ref=e360]: type
                    - combobox [ref=e362]:
                      - option "float" [selected]
                      - option "uint8"
                      - option "int32"
                  - generic [ref=e365]:
                    - generic [ref=e366]: size
                    - group [ref=e367]:
                      - spinbutton "3" [ref=e368]
            - group [ref=e370]:
              - generic [ref=e371]:
                - generic [ref=e372]:
                  - generic "/arc-layer (ArcLayer)" [ref=e373]:
                    - button "arc-layer" [ref=e374]
                    - text: (ArcLayer)
                  - button "" [ref=e376]:
                    - generic: 
                - generic [ref=e377]:
                  - generic [ref=e381]: data
                  - generic [ref=e384]:
                    - generic [ref=e385]: visible
                    - checkbox "visible visible visible" [checked] [ref=e387] [cursor=pointer]
                  - generic [ref=e390]:
                    - generic [ref=e391]: opacity
                    - group [ref=e392]:
                      - spinbutton "opacity opacity opacity" [ref=e393]: "1"
                  - generic [ref=e396]:
                    - generic [ref=e397]: getSourcePosition
                    - generic [ref=e398]:
                      - button "Read from attribute. Click to cycle." [ref=e399] [cursor=pointer]:
                        - img [ref=e400]
                      - textbox "getSourcePosition" [ref=e402]:
                        - /placeholder: sourcePosition
                        - text: sourcePosition
                  - generic [ref=e405]:
                    - generic [ref=e406]: getTargetPosition
                    - generic [ref=e407]:
                      - button "Read from attribute. Click to cycle." [ref=e408] [cursor=pointer]:
                        - img [ref=e409]
                      - textbox "getTargetPosition" [ref=e411]:
                        - /placeholder: targetPosition
                        - text: targetPosition
                  - generic [ref=e415]: getSourceColor
                  - generic [ref=e419]: getTargetColor
                  - generic [ref=e422]:
                    - generic [ref=e423]: getWidth
                    - generic [ref=e424]:
                      - button "Uniform value. Click to cycle." [ref=e425] [cursor=pointer]:
                        - img [ref=e426]
                      - group [ref=e428]:
                        - spinbutton "getWidth" [ref=e429]: "4"
                  - generic [ref=e433]: parameters
            - group [ref=e435]:
              - generic [ref=e436]:
                - generic [ref=e437]:
                  - generic "/pickup-layer (ScatterplotLayer)" [ref=e438]:
                    - button "pickup-layer" [ref=e439]
                    - text: (ScatterplotLayer)
                  - button "" [ref=e441]:
                    - generic: 
                - generic [ref=e442]:
                  - generic [ref=e446]: data
                  - generic [ref=e449]:
                    - generic [ref=e450]: visible
                    - checkbox [checked] [ref=e452] [cursor=pointer]
                  - generic [ref=e455]:
                    - generic [ref=e456]: opacity
                    - group [ref=e457]:
                      - spinbutton "0.8" [ref=e458]
                  - generic [ref=e461]:
                    - generic [ref=e462]: getPosition
                    - generic [ref=e463]:
                      - button "Read from attribute. Click to cycle." [ref=e464] [cursor=pointer]:
                        - img [ref=e465]
                      - textbox "getPosition getPosition" [ref=e467]:
                        - /placeholder: position
                        - text: sourcePosition
                  - generic [ref=e471]: getFillColor
                  - generic [ref=e474]:
                    - generic [ref=e475]: getLineColor
                    - generic [ref=e476]:
                      - button "Uniform value. Click to cycle." [ref=e477] [cursor=pointer]:
                        - img [ref=e478]
                      - button "Open color picker" [ref=e481] [cursor=pointer]
                  - generic [ref=e485]:
                    - generic [ref=e486]: getRadius
                    - generic [ref=e487]:
                      - button "Uniform value. Click to cycle." [ref=e488] [cursor=pointer]:
                        - img [ref=e489]
                      - group [ref=e491]:
                        - spinbutton "getRadius getRadius" [ref=e492]: "10"
                  - generic [ref=e496]: parameters
            - group [ref=e498]:
              - generic [ref=e499]:
                - generic [ref=e500]:
                  - generic "/dropoff-layer (ScatterplotLayer)" [ref=e501]:
                    - button "dropoff-layer" [ref=e502]
                    - text: (ScatterplotLayer)
                  - button "" [ref=e504]:
                    - generic: 
                - generic [ref=e505]:
                  - generic [ref=e509]: data
                  - generic [ref=e512]:
                    - generic [ref=e513]: visible
                    - checkbox [checked] [ref=e515] [cursor=pointer]
                  - generic [ref=e518]:
                    - generic [ref=e519]: opacity
                    - group [ref=e520]:
                      - spinbutton "0.8" [ref=e521]
                  - generic [ref=e524]:
                    - generic [ref=e525]: getPosition
                    - generic [ref=e526]:
                      - button "Read from attribute. Click to cycle." [ref=e527] [cursor=pointer]:
                        - img [ref=e528]
                      - 'textbox "Read from attribute: targetPosition" [ref=e530]':
                        - /placeholder: position
                        - text: targetPosition
                  - generic [ref=e534]: getFillColor
                  - generic [ref=e537]:
                    - generic [ref=e538]: getLineColor
                    - generic [ref=e539]:
                      - button "Uniform value. Click to cycle." [ref=e540] [cursor=pointer]:
                        - img [ref=e541]
                      - button "Open color picker" [ref=e544] [cursor=pointer]
                  - generic [ref=e548]:
                    - generic [ref=e549]: getRadius
                    - generic [ref=e550]:
                      - button "Uniform value. Click to cycle." [ref=e551] [cursor=pointer]:
                        - img [ref=e552]
                      - group [ref=e554]:
                        - spinbutton "10" [ref=e555]
                  - generic [ref=e559]: parameters
            - group [ref=e561]:
              - generic [ref=e562]:
                - generic [ref=e563]:
                  - generic "/deck (DeckRenderer)" [ref=e564]:
                    - button "deck" [ref=e565]
                    - text: (DeckRenderer)
                  - button "" [ref=e567]:
                    - generic: 
                - generic [ref=e568]:
                  - generic [ref=e572]: layers
                  - generic [ref=e576]: views
                  - generic [ref=e580]: basemap
            - group [ref=e582]:
              - generic [ref=e583]:
                - generic [ref=e584]:
                  - generic "/out (Out)" [ref=e585]:
                    - button "out" [ref=e586]
                    - text: (Out)
                  - button "" [ref=e588]:
                    - generic: 
                - generic [ref=e593]: vis
      - img
      - generic "Control Panel" [ref=e594]:
        - button "Zoom In" [ref=e595] [cursor=pointer]:
          - img [ref=e596]
        - button "Zoom Out" [ref=e598] [cursor=pointer]:
          - img [ref=e599]
        - button "Fit View" [ref=e601] [cursor=pointer]:
          - img [ref=e602]
        - button "Toggle Interactivity" [ref=e604] [cursor=pointer]:
          - img [ref=e605]
      - link "React Flow attribution" [ref=e608] [cursor=pointer]:
        - /url: https://reactflow.dev
        - text: React Flow
```

# Test source

```ts
  1   | /**
  2   |  * Visual Regression Tests for Example Projects
  3   |  *
  4   |  * These are true E2E tests using Playwright that:
  5   |  * - Navigate to each example
  6   |  * - Wait for data to load
  7   |  * - Validate Deck.gl rendering
  8   |  * - Take screenshots for visual regression
  9   |  * - Test animation frames
  10  |  *
  11  |  * Run with: npx playwright test examples-visual-regression
  12  |  * Update snapshots: npx playwright test examples-visual-regression --update-snapshots
  13  |  */
  14  | 
  15  | import { test, expect, type Page } from '@playwright/test'
  16  | 
  17  | // Examples that have animation (keyframes in timeline)
  18  | const ANIMATED_EXAMPLES = ['world-flights', 'cesium-hubble']
  19  | 
  20  | // Test frames for animated examples (in seconds)
  21  | const TEST_FRAMES = [0, 0.5, 1.0, 2.0]
  22  | 
  23  | // List of examples to test
  24  | const EXAMPLES = [
  25  |   '3d-building-gradient',
  26  |   'aggregation-example',
  27  |   'california-earthquakes',
  28  |   'cesium-hubble',
  29  |   'chargers',
  30  |   'custom-maplibre-layer-test',
  31  |   'geojson-example',
  32  |   'icon-layer-test',
  33  |   'nyc-census',
  34  |   'nyc-taxis',
  35  |   'orbit',
  36  |   'sf-elevation-contours',
  37  |   'sf-street-trees',
  38  |   'simple-mesh-example',
  39  |   'uk-commute',
  40  |   'us-county-unemployment',
  41  |   'world-flights',
  42  | ]
  43  | 
  44  | test.describe('Example Projects Visual Regression', () => {
  45  |   for (const exampleName of EXAMPLES) {
  46  |     const isAnimated = ANIMATED_EXAMPLES.includes(exampleName)
  47  | 
  48  |     test(
  49  |       `${exampleName} renders correctly`,
  50  |       async ({ page }) => {
  51  |         // Navigate to the example
  52  |         await page.goto(`/examples/${exampleName}`)
  53  | 
  54  |         // Wait for Deck.gl canvas to appear
  55  |         await page.waitForSelector('canvas', { timeout: 10000 })
  56  | 
  57  |         // Check for React error boundaries
  58  |         const errorBoundary = await page.locator('[role="alert"]').count()
  59  |         expect(errorBoundary).toBe(0)
  60  | 
  61  |         // Wait for data to load - poll until layers have data
> 62  |         await page.waitForFunction(
      |                    ^ Error: page.waitForFunction: Test timeout of 30000ms exceeded.
  63  |           () => {
  64  |             const deckInstance = (window as any).deck
  65  |             if (!deckInstance?.layerManager) return false
  66  | 
  67  |             const layers = deckInstance.layerManager.getLayers()
  68  |             if (layers.length === 0) return false
  69  | 
  70  |             // Check if at least one layer has loaded data
  71  |             return layers.some((layer: any) => {
  72  |               const data = layer.props.data
  73  |               if (Array.isArray(data) && data.length > 0) return true
  74  |               // Some layers use data that's not arrays (e.g., TileLayer, TerrainLayer)
  75  |               if (data && typeof data === 'object') return true
  76  |               return false
  77  |             })
  78  |           },
  79  |           { timeout: 15000 }
  80  |         )
  81  | 
  82  |         // Wait a bit more for map tiles to load
  83  |         await page.waitForTimeout(2000)
  84  | 
  85  |         // Inspect Deck.gl state to validate rendering
  86  |         const deckState = await page.evaluate(() => {
  87  |           const deckInstance = (window as any).deck
  88  |           if (!deckInstance) {
  89  |             return { error: 'Deck.gl instance not found on window.deck' }
  90  |           }
  91  | 
  92  |           const layerManager = deckInstance.layerManager
  93  |           if (!layerManager) {
  94  |             return { error: 'LayerManager not found' }
  95  |           }
  96  | 
  97  |           const layers = layerManager.getLayers()
  98  |           return {
  99  |             layerCount: layers.length,
  100 |             layers: layers.map((layer: any) => ({
  101 |               id: layer.id,
  102 |               type: layer.constructor.name,
  103 |               visible: layer.props.visible !== false,
  104 |               dataLength: Array.isArray(layer.props.data) ? layer.props.data.length : 'N/A',
  105 |               opacity: layer.props.opacity,
  106 |             })),
  107 |           }
  108 |         })
  109 | 
  110 |         // Validate Deck.gl rendered layers
  111 |         if ('error' in deckState) {
  112 |           throw new Error(`${exampleName}: ${deckState.error}`)
  113 |         }
  114 | 
  115 |         // Should have at least one layer
  116 |         expect(deckState.layerCount).toBeGreaterThan(0)
  117 | 
  118 |         // Log layer info for debugging
  119 |         console.log(`${exampleName}: ${deckState.layerCount} layers rendered`)
  120 |         for (const layer of deckState.layers) {
  121 |           console.log(
  122 |             `  - ${layer.id} (${layer.type}): ${layer.dataLength} items, visible=${layer.visible}`
  123 |           )
  124 |         }
  125 | 
  126 |         // All layers should be visible (unless explicitly hidden)
  127 |         const visibleLayers = deckState.layers.filter(l => l.visible)
  128 |         expect(visibleLayers.length).toBeGreaterThan(0)
  129 | 
  130 |         // Layers with data should have non-zero length
  131 |         const layersWithData = deckState.layers.filter(l => typeof l.dataLength === 'number')
  132 |         if (layersWithData.length > 0) {
  133 |           const hasDataInSomeLayer = layersWithData.some(l => l.dataLength > 0)
  134 |           expect(hasDataInSomeLayer).toBe(true)
  135 |         }
  136 | 
  137 |         // Take screenshot for visual regression
  138 |         const canvas = page.locator('canvas').first()
  139 |         await expect(canvas).toHaveScreenshot(`${exampleName}-initial.png`, {
  140 |           maxDiffPixels: 100, // Allow some anti-aliasing differences
  141 |         })
  142 | 
  143 |         // For animated examples, test multiple frames
  144 |         if (isAnimated) {
  145 |           for (const time of TEST_FRAMES) {
  146 |             // Seek to specific time in timeline
  147 |             await page.evaluate((seekTime: number) => {
  148 |               const getTimelineStore = (window as any).getTimelineStore
  149 |               if (getTimelineStore) {
  150 |                 const store = getTimelineStore()
  151 |                 store.setPosition(seekTime)
  152 |               }
  153 |             }, time)
  154 | 
  155 |             // Wait for render and data loading
  156 |             await page.waitForTimeout(1000)
  157 | 
  158 |             // Take screenshot at this frame
  159 |             await expect(canvas).toHaveScreenshot(`${exampleName}-frame-${time}s.png`, {
  160 |               maxDiffPixels: 100,
  161 |             })
  162 |           }
```