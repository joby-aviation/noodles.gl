# Screenshot Guide

How to capture and update documentation screenshots for the Noodles.gl website.

## Setup

1. Start the dev server:
   ```bash
   cd noodles-editor && npm start
   ```

2. Connect Chrome DevTools MCP (via Claude Code or Claude Desktop) to the running browser.

3. Navigate to a representative example project:
   ```
   http://localhost:5173/examples/nyc-taxis
   ```

## Capturing Screenshots

### Recommended viewport

Resize the page to **1280x800** for consistent screenshots:
```
resize_page({ width: 1280, height: 800 })
```

### Workflow

1. **Navigate** to the page/state you want to capture
2. **Take a full-page screenshot** to a temporary file:
   ```
   take_screenshot({ filePath: "website/static/img/my-screenshot-full.png" })
   ```
3. **Crop** using macOS `sips` (or ImageMagick `convert` on Linux):
   ```bash
   # sips --cropToHeightWidth <height> <width> --cropOffset <y> <x> input.png --out output.png
   sips --cropToHeightWidth 736 296 --cropOffset 40 984 full.png --out cropped.png
   ```
4. **Find element coordinates** using evaluate_script:
   ```javascript
   () => {
     const el = document.querySelector('[class*="rightWidgetWrapper"]');
     const rect = el.getBoundingClientRect();
     return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
   }
   ```
5. **Trigger UI states** (context menus, hovers) via evaluate_script before capturing:
   ```javascript
   () => {
     const target = document.querySelector('[role="listitem"]');
     const rect = target.getBoundingClientRect();
     target.dispatchEvent(new MouseEvent('contextmenu', {
       bubbles: true, cancelable: true,
       clientX: rect.left + rect.width / 2,
       clientY: rect.top + rect.height / 2,
       button: 2
     }));
   }
   ```

## File Conventions

- **Location**: `website/static/img/`
- **Naming**: `{feature}-{description}.png` (e.g., `properties-panel-overview.png`)
- **Format**: PNG for UI screenshots
- **Size**: Crop tightly to relevant UI region — no browser chrome, no excess canvas

## Existing Screenshots

| File | Shows |
|------|-------|
| `properties-panel-overview.png` | Full properties panel with arc-layer selected |
| `properties-panel-context-menu.png` | Right-click context menu on a field |
| `properties-panel-keyframe.png` | Field rows with keyframe diamond indicators |

## Tips

- Select a node before capturing the properties panel (click its title button)
- Use `evaluate_script` to dispatch synthetic events for context menus, hover states, etc.
- Delete intermediate full-page screenshots after cropping
- If the panel position shifts (e.g., viewport resize), re-query the element's bounding rect before cropping
