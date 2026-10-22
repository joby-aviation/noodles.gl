# Changelog

All notable changes to Noodles.gl are documented here.

## August 2026

### Added
- Comprehensive GIS tools and ease-of-use features ([#519](https://github.com/joby-aviation/noodles.gl/pull/519))
- deck.gl scale widget operator ([#526](https://github.com/joby-aviation/noodles.gl/pull/526))
- Resizable panel system replacing fixed layout modes ([#465](https://github.com/joby-aviation/noodles.gl/pull/465))
- Freeform input support for StringLiteralField ([#442](https://github.com/joby-aviation/noodles.gl/pull/442))
- Editable defaults in table schemas ([#545](https://github.com/joby-aviation/noodles.gl/pull/545))

### Changed
- Upgraded deck.gl to 9.3.8, then 9.3.10 ([#533](https://github.com/joby-aviation/noodles.gl/pull/533), [#546](https://github.com/joby-aviation/noodles.gl/pull/546))

### Fixed
- Unchanged for-loops rerunning unnecessarily ([#523](https://github.com/joby-aviation/noodles.gl/pull/523))
- ForLoop visual membership synced with graph connections and execution scope, with unique group IDs and legacy group migration ([#541](https://github.com/joby-aviation/noodles.gl/pull/541), [#542](https://github.com/joby-aviation/noodles.gl/pull/542), [#539](https://github.com/joby-aviation/noodles.gl/pull/539), [#544](https://github.com/joby-aviation/noodles.gl/pull/544))
- Layer loading errors now surfaced instead of hanging render ([#521](https://github.com/joby-aviation/noodles.gl/pull/521))
- Connected geocoder queries not executing ([#522](https://github.com/joby-aviation/noodles.gl/pull/522))
- TableEditor string literals now use a dropdown; active cell commits before row mutations ([#524](https://github.com/joby-aviation/noodles.gl/pull/524), [#535](https://github.com/joby-aviation/noodles.gl/pull/535))
- JSON inputs now supported for icon mappings ([#527](https://github.com/joby-aviation/noodles.gl/pull/527))

## July 2026

### Added
- Blender-style multi-input handles with order-correct data flow ([#120](https://github.com/joby-aviation/noodles.gl/pull/120))
- WebMCP support for external control from Claude Code, with origin trial token ([#508](https://github.com/joby-aviation/noodles.gl/pull/508), [#510](https://github.com/joby-aviation/noodles.gl/pull/510))
- Spreadsheet pane for tabular data inspection ([#466](https://github.com/joby-aviation/noodles.gl/pull/466))
- Copy/paste support for timeline keyframes ([#388](https://github.com/joby-aviation/noodles.gl/pull/388))
- Free API fallbacks and key nudges for AI features ([#396](https://github.com/joby-aviation/noodles.gl/pull/396))
- Improved properties panel context menu and visual alignment ([#504](https://github.com/joby-aviation/noodles.gl/pull/504))
- Homepage redesigned with visual-first layout and example screenshots ([#517](https://github.com/joby-aviation/noodles.gl/pull/517))

### Fixed
- Container scope-boundary bugs: copy-paste, delete cascade, undo/redo ([#503](https://github.com/joby-aviation/noodles.gl/pull/503))
- MapLibre flickering via deep equality checks and icon caching ([#447](https://github.com/joby-aviation/noodles.gl/pull/447))
- Node disappearing when title input blurred without changes ([#518](https://github.com/joby-aviation/noodles.gl/pull/518))
- Crash when renaming nodes with upstream connections ([#136](https://github.com/joby-aviation/noodles.gl/pull/136))

## June 2026

### Added
- Timeline MCP tools and improved AI integration guidance ([#487](https://github.com/joby-aviation/noodles.gl/pull/487))
- Undo/redo support for TableEditorOp edits ([#499](https://github.com/joby-aviation/noodles.gl/pull/499))
- Point2D/3DField accepts GeoJSON Point Features, with geometry-column detection for NetworkOp compatibility ([#482](https://github.com/joby-aviation/noodles.gl/pull/482), [#486](https://github.com/joby-aviation/noodles.gl/pull/486), [#498](https://github.com/joby-aviation/noodles.gl/pull/498))
- Greyscale categorical color ramp with configurable steps ([#478](https://github.com/joby-aviation/noodles.gl/pull/478))
- Improved op() error messages in CodeOp/ExpressionOp/AccessorOp ([#484](https://github.com/joby-aviation/noodles.gl/pull/484))

### Changed
- Operator properties panel shows all fields by default, removed pencil icon toggle ([#485](https://github.com/joby-aviation/noodles.gl/pull/485))

### Fixed
- Point field schema not transforming tuples to objects ([#500](https://github.com/joby-aviation/noodles.gl/pull/500))
- False "unsaved changes" warnings from improved dirty-state detection ([#493](https://github.com/joby-aviation/noodles.gl/pull/493))
- op() references with double-quoted paths ([#483](https://github.com/joby-aviation/noodles.gl/pull/483))

## May 2026

### Added
- Timeline in/out points with draggable markers and loop playback, applied to rendering frame range ([#445](https://github.com/joby-aviation/noodles.gl/pull/445), [#454](https://github.com/joby-aviation/noodles.gl/pull/454), [#457](https://github.com/joby-aviation/noodles.gl/pull/457))
- Real-time keyframe value updates while editing timeline ([#446](https://github.com/joby-aviation/noodles.gl/pull/446))
- Timeline zoom around playhead with shift-scroll ([#443](https://github.com/joby-aviation/noodles.gl/pull/443))
- Timeline variables in CodeOp/ExpressionField with reactive tracking ([#441](https://github.com/joby-aviation/noodles.gl/pull/441))
- Timezone support and Temporal.ZonedDateTime output for TableEditorOp, plus a DateTime field ([#440](https://github.com/joby-aviation/noodles.gl/pull/440), [#436](https://github.com/joby-aviation/noodles.gl/pull/436))
- File upload support for IconLayerOp icon atlas ([#437](https://github.com/joby-aviation/noodles.gl/pull/437))
- SmoothOp for Gaussian/boxcar smoothing ([#460](https://github.com/joby-aviation/noodles.gl/pull/460))
- Keyframe shape variations based on interpolation type ([#459](https://github.com/joby-aviation/noodles.gl/pull/459))
- Edge bars from sequence boundaries to first/last keyframes ([#458](https://github.com/joby-aviation/noodles.gl/pull/458))
- One-click ViewerOp to TableEditorOp conversion ([#480](https://github.com/joby-aviation/noodles.gl/pull/480))
- Executing indicator for ops taking longer than 200ms ([#476](https://github.com/joby-aviation/noodles.gl/pull/476))

### Changed
- Optimized ReactFlow usage, reducing unnecessary re-renders ([#434](https://github.com/joby-aviation/noodles.gl/pull/434))

### Fixed
- Custom resolution selection not taking effect ([#473](https://github.com/joby-aviation/noodles.gl/pull/473))

## April 2026

### Added
- TableEditorOp v2 with typed schema system ([#423](https://github.com/joby-aviation/noodles.gl/pull/423))
- MapStyleConfigurator operator for visual map style editing, replacing MapStyleOp with typeahead on MaplibreBasemapOp ([#378](https://github.com/joby-aviation/noodles.gl/pull/378), [#393](https://github.com/joby-aviation/noodles.gl/pull/393))
- RampOp operator with interactive curve editor ([#398](https://github.com/joby-aviation/noodles.gl/pull/398))
- LegendWidget operator, with scale input ([#408](https://github.com/joby-aviation/noodles.gl/pull/408), [#412](https://github.com/joby-aviation/noodles.gl/pull/412))
- Custom parameter editor for dynamic field creation ([#231](https://github.com/joby-aviation/noodles.gl/pull/231))
- CrossOp for generating unique pairs, SimplifyOp for GeoJSON simplification ([#426](https://github.com/joby-aviation/noodles.gl/pull/426), [#424](https://github.com/joby-aviation/noodles.gl/pull/424))
- CustomMapLibreLayer operator for custom WebGL layers ([#430](https://github.com/joby-aviation/noodles.gl/pull/430))
- BitmapOverlayWidget for screen-space image overlays ([#428](https://github.com/joby-aviation/noodles.gl/pull/428))
- Virtual in-memory filesystem for projects ([#432](https://github.com/joby-aviation/noodles.gl/pull/432))
- Per-channel keyframing for Vec2, Vec3, Point2D, and Point3D fields ([#375](https://github.com/joby-aviation/noodles.gl/pull/375))
- Debug breakpoint toggle on operator nodes ([#421](https://github.com/joby-aviation/noodles.gl/pull/421))
- Download SVG from ViewerOp when input is a chart element ([#411](https://github.com/joby-aviation/noodles.gl/pull/411))

### Changed
- Lazy-loaded heavy dependencies to reduce initial bundle size ([#403](https://github.com/joby-aviation/noodles.gl/pull/403))

### Fixed
- ForLoop execution correctness in the pull-based system ([#429](https://github.com/joby-aviation/noodles.gl/pull/429))
- BitmapLayerOp edit button crash, improved error boundaries ([#425](https://github.com/joby-aviation/noodles.gl/pull/425))
- Recovery from stale edges and unknown operator types ([#417](https://github.com/joby-aviation/noodles.gl/pull/417))

## March 2026

### Added
- Native timeline system replacing Theatre.js: Theatre.js-style keyframe controls, editable speed graph (After Effects style), Cavalry-style time markers, keyframed-field highlighting ([#349](https://github.com/joby-aviation/noodles.gl/pull/349), [#354](https://github.com/joby-aviation/noodles.gl/pull/354), [#359](https://github.com/joby-aviation/noodles.gl/pull/359), [#356](https://github.com/joby-aviation/noodles.gl/pull/356))
- Undo/redo history for operator property changes ([#362](https://github.com/joby-aviation/noodles.gl/pull/362))
- PNG sequence export capability ([#360](https://github.com/joby-aviation/noodles.gl/pull/360))
- Reroute operator for graph organization ([#371](https://github.com/joby-aviation/noodles.gl/pull/371))
- Swap connection on edge drop, and highlight target edge during connection drag ([#372](https://github.com/joby-aviation/noodles.gl/pull/372), [#383](https://github.com/joby-aviation/noodles.gl/pull/383))
- Resizable timeline panel ([#384](https://github.com/joby-aviation/noodles.gl/pull/384))
- Background rendering via worker timers ([#368](https://github.com/joby-aviation/noodles.gl/pull/368))
- FileUrlField combining FileField and JSONUrlField with upload support ([#374](https://github.com/joby-aviation/noodles.gl/pull/374))
- Transparent basemap support by preserving geo viewState in deckProps ([#363](https://github.com/joby-aviation/noodles.gl/pull/363))

### Changed
- Removed Theatre.js dependency entirely — render settings, project loading, and keyframing rebuilt on the native timeline ([#269](https://github.com/joby-aviation/noodles.gl/pull/269))
- Migrated from Yarn to npm, adopted npm workspaces for faster Cloudflare builds ([#381](https://github.com/joby-aviation/noodles.gl/pull/381), [#390](https://github.com/joby-aviation/noodles.gl/pull/390))
- Upgraded TypeScript to 6.0.2 ([#391](https://github.com/joby-aviation/noodles.gl/pull/391))

### Fixed
- Slow node dragging via O(1) edge connection lookup and fewer graph transforms ([#347](https://github.com/joby-aviation/noodles.gl/pull/347), [#232](https://github.com/joby-aviation/noodles.gl/pull/232))
- Timeline scrub slowness ([#346](https://github.com/joby-aviation/noodles.gl/pull/346))
- Stale frame encoded at render start ([#314](https://github.com/joby-aviation/noodles.gl/pull/314))

## February 2026

### Added
- /projects page with modal routes and File menu links ([#313](https://github.com/joby-aviation/noodles.gl/pull/313))
- TSV format support in FileOp ([#304](https://github.com/joby-aviation/noodles.gl/pull/304))
- Fully qualified handle names shown in property list connections ([#309](https://github.com/joby-aviation/noodles.gl/pull/309))
- depthTest parameter added to all layer operators ([#311](https://github.com/joby-aviation/noodles.gl/pull/311))

### Fixed
- Layer reordering by fixing edge handle format matching ([#310](https://github.com/joby-aviation/noodles.gl/pull/310))
- Memory leak during video export ([#316](https://github.com/joby-aviation/noodles.gl/pull/316))

## January 2026

### Added
- Editable field visibility with show/hide controls in Properties panel ([#283](https://github.com/joby-aviation/noodles.gl/pull/283))
- Dim unconnectable nodes during connection drag ([#250](https://github.com/joby-aviation/noodles.gl/pull/250))

### Changed
- ForLoop now returns array of all iteration results ([#240](https://github.com/joby-aviation/noodles.gl/pull/240))
- ForLoop field renamed from 'd' to 'item' for clarity ([#240](https://github.com/joby-aviation/noodles.gl/pull/240))

### Fixed
- Theatre.js cold prism warning ([#258](https://github.com/joby-aviation/noodles.gl/pull/258))
- "Project not found" dialog after File > Import then Save ([#188](https://github.com/joby-aviation/noodles.gl/pull/188))
- Parent group node included when copying ForLoop nodes ([#222](https://github.com/joby-aviation/noodles.gl/pull/222))
- Syntax error messaging for ExpressionOp and CodeOp ([#244](https://github.com/joby-aviation/noodles.gl/pull/244))
- Connection constraint violation error messages ([#255](https://github.com/joby-aviation/noodles.gl/pull/255))

## December 2025

### Added
- Tools shelf with PointOp wizard and CSV importer ([#192](https://github.com/joby-aviation/noodles.gl/pull/192))
- Collapsible sidebar with node renaming ([#193](https://github.com/joby-aviation/noodles.gl/pull/193))
- OrthographicView operator ([#179](https://github.com/joby-aviation/noodles.gl/pull/179))
- TopMenuBar with hamburger menu ([#163](https://github.com/joby-aviation/noodles.gl/pull/163))
- "I" key navigation for drilling into containers ([#159](https://github.com/joby-aviation/noodles.gl/pull/159))
- Keyboard shortcuts centralized in KeyboardManager ([#169](https://github.com/joby-aviation/noodles.gl/pull/169))
- SDF font settings for TextLayer ([#202](https://github.com/joby-aviation/noodles.gl/pull/202))
- Text rendering properties on GeoJsonLayer ([#200](https://github.com/joby-aviation/noodles.gl/pull/200))
- API Keys UI in Settings menu ([#190](https://github.com/joby-aviation/noodles.gl/pull/190))
- ChromePicker for color fields ([#177](https://github.com/joby-aviation/noodles.gl/pull/177))
- External AI control for automated pipeline creation ([#211](https://github.com/joby-aviation/noodles.gl/pull/211))
- AI skills for generating projects and refactoring ([#150](https://github.com/joby-aviation/noodles.gl/pull/150))
- GraphExecutor architecture for scope-based control flow ([#214](https://github.com/joby-aviation/noodles.gl/pull/214))
- softMin/softMax properties on NumberField ([#215](https://github.com/joby-aviation/noodles.gl/pull/215))
- Text and binary format options in FileOp ([#210](https://github.com/joby-aviation/noodles.gl/pull/210))
- Allow incompatible operator connections with error surfacing ([#224](https://github.com/joby-aviation/noodles.gl/pull/224))
- Node insertion on edge drop ([#223](https://github.com/joby-aviation/noodles.gl/pull/223))
- Error popover on execution state change ([#256](https://github.com/joby-aviation/noodles.gl/pull/256))
- PostHog error tracking with React 19 hooks ([#245](https://github.com/joby-aviation/noodles.gl/pull/245))
- Projection switching in MaplibreBasemapOp ([#187](https://github.com/joby-aviation/noodles.gl/pull/187))

### Changed
- ReactFlow upgraded from v11 to v12 ([#221](https://github.com/joby-aviation/noodles.gl/pull/221))
- Migrated from Volta to Corepack ([#174](https://github.com/joby-aviation/noodles.gl/pull/174))

### Fixed
- Prevent "Locate Project" dialog after successful creation ([#180](https://github.com/joby-aviation/noodles.gl/pull/180))
- DateField Theatre.js sync with integer milliseconds ([#185](https://github.com/joby-aviation/noodles.gl/pull/185))
- Preserve operator names in production builds ([#181](https://github.com/joby-aviation/noodles.gl/pull/181))
- DuckDB-WASM worker loading on Cloudflare Pages ([#220](https://github.com/joby-aviation/noodles.gl/pull/220))
- Viewer operator placement and selection logic ([#242](https://github.com/joby-aviation/noodles.gl/pull/242))
- False unsaved changes warnings on node dimension updates ([#246](https://github.com/joby-aviation/noodles.gl/pull/246))

## November 2025

### Added
- Undo/Redo functionality ([#4](https://github.com/joby-aviation/noodles.gl/pull/4))
- PostHog analytics with opt-in consent ([#127](https://github.com/joby-aviation/noodles.gl/pull/127))
- TimeSeriesOp for time-based data interpolation ([#62](https://github.com/joby-aviation/noodles.gl/pull/62))
- KmlToGeoJsonOp for KML conversion ([#118](https://github.com/joby-aviation/noodles.gl/pull/118))
- DateTimeOp with second/millisecond precision ([#142](https://github.com/joby-aviation/noodles.gl/pull/142))
- GeoJsonField type with lime handle color ([#119](https://github.com/joby-aviation/noodles.gl/pull/119))
- Temporal blending support in SwitchOp ([#141](https://github.com/joby-aviation/noodles.gl/pull/141))

### Changed
- Migrated state management to Zustand ([#132](https://github.com/joby-aviation/noodles.gl/pull/132))
- Examples directory restructured to `/public/examples` ([#68](https://github.com/joby-aviation/noodles.gl/pull/68))
- Lazy-loading for examples to reduce bundle size ([#154](https://github.com/joby-aviation/noodles.gl/pull/154))

### Fixed
- Theatre.js naming collision with containers ([#134](https://github.com/joby-aviation/noodles.gl/pull/134))
- Breadcrumb bar and container state changes ([#117](https://github.com/joby-aviation/noodles.gl/pull/117))

## October 2025 - Initial Release

### Added
- Core node-based editor with reactive data flow
- Claude AI chat sidebar integration ([#26](https://github.com/joby-aviation/noodles.gl/pull/26))
- Block Library with search by name and descriptions ([#64](https://github.com/joby-aviation/noodles.gl/pull/64), [#69](https://github.com/joby-aviation/noodles.gl/pull/69), [#99](https://github.com/joby-aviation/noodles.gl/pull/99))
- Export project as ZIP ([#96](https://github.com/joby-aviation/noodles.gl/pull/96))
- MapLibreBaseMapOp auto-added to new projects ([#98](https://github.com/joby-aviation/noodles.gl/pull/98))
- SwitchOp value blending ([#90](https://github.com/joby-aviation/noodles.gl/pull/90))
- Temporal types for DateFields ([#63](https://github.com/joby-aviation/noodles.gl/pull/63))
- Multi-statement SQL support in DuckDB ([#40](https://github.com/joby-aviation/noodles.gl/pull/40))
- AGENTS.md for LLM context ([#60](https://github.com/joby-aviation/noodles.gl/pull/60))

### Changed
- Upgraded to React 19 and Vite 7 ([#81](https://github.com/joby-aviation/noodles.gl/pull/81))
- Renamed MergeOp to ConcatOp, ObjectMergeOp to MergeOp ([#75](https://github.com/joby-aviation/noodles.gl/pull/75))
