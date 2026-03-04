// Z-index tier constants for use in React inline styles.
// Keep in sync with --z-index-* custom properties in noodles/noodles.module.css.
export const Z_INDEX = {
  BACKGROUND: -99, // Behind canvas (for-loop groups)
  NODE_TOOLTIP: 101, // Tooltip containers within canvas stacking context
  CANVAS: 999, // React Flow canvas wrapper
  CHROME: 1000, // App chrome: breadcrumbs, panels, dropdowns
  BANNER: 9998, // Notification banners, consent overlays
  BACKDROP: 9999, // Modal/dialog backdrop overlays
  MODAL: 10000, // Modal content, menus, dialogs, popovers
  TOP: 10001, // Absolute top (step ladder)
} as const
