# Changelog

All notable changes to Noodles.gl are documented here.

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
