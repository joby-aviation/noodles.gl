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
6. **Render a fake cursor** to show where a click/right-click happened:
   ```javascript
   () => {
     const cursor = document.createElement('div');
     cursor.id = 'fake-cursor';
     cursor.style.cssText = 'position:fixed; left:1094px; top:211px; z-index:999999; pointer-events:none;';
     cursor.innerHTML = `<svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
       <path d="M1 1L1 16L5.5 12L9 19L11.5 18L8 11L14 11L1 1Z" fill="white" stroke="black" stroke-width="1.2"/>
     </svg>`;
     document.body.appendChild(cursor);
   }
   ```
   Position `left`/`top` at the click coordinates (offset a few px up-left so the arrow tip lands on the target). Remove after capturing with `document.getElementById('fake-cursor').remove()`.

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
- For context menus, trigger on a field near the top of the list so the menu opens downward without covering the target field's label
- Add a fake cursor (step 6 above) to indicate where the user right-clicked — position it so the arrow tip points at the target row
