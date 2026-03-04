// Single source of truth for z-index tier values.
// Imported by z-index.ts (typed export for TSX) and postcss.config.js (CSS generation).
export const Z_INDEX = {
  BACKGROUND: -99, // behind canvas (for-loop groups)
  NODE_TOOLTIP: 101, // tooltip containers within canvas stacking context
  CANVAS: 999, // react flow canvas wrapper
  CHROME: 1000, // app chrome: breadcrumbs, panels, dropdowns
  BANNER: 9998, // notification banners, consent overlays
  BACKDROP: 9999, // modal/dialog backdrop overlays
  MODAL: 10000, // modal content, menus, dialogs, popovers
  TOP: 10001, // absolute top (step ladder)
}
