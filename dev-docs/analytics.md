# Analytics Integration

Privacy-preserving product analytics using PostHog and Google Analytics to understand feature usage and improve the Noodles.gl editor.

## Overview

Noodles.gl uses both PostHog and Google Analytics for product analytics with a privacy-first approach:

- **Opt-in by default**: Users must explicitly consent before data collection
- **No sensitive data**: Never tracks project names, node data, code, queries, or API keys
- **Manual events only**: No automatic capture or session recording
- **Easy opt-out**: Users can disable anytime in Settings
- **Ad-blocker resilient**: Gracefully handles blocking without breaking the app
- **Error tracking for all users**: Exceptions are logged regardless of consent to maintain application stability

## Setup

### Environment Variables

Add to `.env.local` (see `.env.local.example`):

```env
VITE_POSTHOG_API_KEY=phc_your_key_here
VITE_POSTHOG_HOST=https://us.i.posthog.com  # Optional
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

### Getting Analytics Keys

**PostHog:**
1. Sign up at https://posthog.com (free tier: 1M events/month)
2. Create a new project
3. Copy Project API Key from Project Settings
4. Add to `.env.local`

**Google Analytics:**
1. Sign in at https://analytics.google.com
2. Create a new GA4 property
3. Copy Measurement ID (format: G-XXXXXXXXXX)
4. Add to `.env.local`

## Architecture

### Core Files

| File | Purpose |
|------|---------|
| `src/utils/analytics.ts` | Analytics manager singleton with consent management |
| `src/components/analytics-consent-banner.tsx` | First-visit consent banner |
| `src/components/settings-dialog.tsx` | Settings UI with analytics toggle |
| `src/index.tsx` | Analytics initialization |
| `src/reportWebVitals.ts` | Web Vitals performance tracking |

### Key Features

1. **Consent Management** - localStorage-based user preference persistence
2. **Data Filtering** - Automatic removal of sensitive properties
3. **Error Handling** - Try-catch blocks around all analytics calls
4. **Error Boundary** - Catches analytics component failures
5. **Dual Tracking** - Events sent to both PostHog and Google Analytics when enabled
6. **Opt-out Tracking** - Tracks when users decline consent (to measure opt-out rates)
7. **Privacy Configuration**:
   - PostHog: `opt_out_capturing_by_default: true`, `autocapture: false`, `disable_session_recording: true`
   - Google Analytics: `anonymize_ip: true`, consent mode API

## Currently Tracked Events

### Project Operations

| Event | Properties | Location |
|-------|-----------|----------|
| `project_created` | `method` | menu.tsx |
| `project_imported` | - | menu.tsx |
| `project_saved` | `storageType, isFirstSave` | menu.tsx |
| `project_save_failed` | `storageType, error` | menu.tsx |
| `project_exported` | `storageType` | menu.tsx |
| `project_opened` | `storageType, source` | menu.tsx, noodles.tsx, project-not-found-dialog.tsx |
| `project_open_failed` | `storageType, error` or `storageType, reason, source` | menu.tsx, noodles.tsx, project-not-found-dialog.tsx |
| `project_permission_granted` | `source` | projects-view.tsx, project-not-found-dialog.tsx |
| `project_permission_denied` | `source, state` | projects-view.tsx, project-not-found-dialog.tsx |
| `project_removed_from_list` | `storageType, source` | projects-view.tsx |
| `project_folder_reconnected` | `source, folderNameChanged` | projects-view.tsx |

Opening a saved project by its URL (`/projects/:name`, which is where Recent projects and the Projects tab go) reports `source`. The Open menu sends no `source`, and its failures send `error` (`load_error`, `migration_error`, `unknown`) instead of `reason`.

- `source`: `url` (the project page loaded the project from storage), `allow_button` (the "Allow access" button on the project page), `choose_folder` (the "Choose folder" button on the project page), `project_list` (a click in Recent projects or the Projects tab) or `project_menu` ("Allow access" in a project's "..." menu)
- `project_removed_from_list` and `project_folder_reconnected` come from a project's "..." menu in the Projects tab or Recent projects. Their `source` is `projects_tab` or `recent_projects`. Removing forgets the remembered folder; it never deletes files. `project_folder_reconnected` is "Choose folder…" pointing the project at a folder with a `noodles.json`; `folderNameChanged` is true when that folder has a different name, which renames the project in the list
- `reason`: the storage error type in snake_case: `permission_prompt` (the browser forgot the folder's permission, usually after a restart, and needs a click to ask again), `permission_denied`, `not_found` (no folder is remembered for the project, or it has no `noodles.json`), `migration_error`, or another storage error such as `security_error` or `unknown`
- `state`: what the browser returned when asked for access: `prompt` (the user dismissed the prompt) or `denied` (blocked)
- A local folder's permission is only requested during a click. The project page reads it without asking, so a `permission_prompt` failure is followed by the "Allow access" button, not a browser prompt.
- Project and folder names are never sent

### Node Operations

| Event | Properties | Location |
|-------|-----------|----------|
| `node_added` | `nodeType` (`CommentOp` for a comment) | use-project-modifications.ts |
| `node_deleted` | `count` | use-project-modifications.ts |
| `edge_added` | `count` | use-project-modifications.ts |
| `edge_deleted` | `count` | use-project-modifications.ts |
| `starter_node_selected` | `operatorType` | noodles.tsx |
| `ai_modification_proposed` | `provider, modificationCount` | chat-panel.tsx |
| `ai_modification_proposal_resolved` | `provider, outcome, modificationCount` | chat-panel.tsx |

- `outcome`: `accepted`, `rejected`, or `failed` (accepted, but the editor refused the batch)
- `starter_node_selected`: an example opened and the editor selected a node for it (its main layer, or the example's `editorSettings.startNode`), so the properties panel shows controls. Sent once per example per page load, only for the bundled example file, and never with `?externalControl=true` or agent bench mode. `operatorType` is the operator class, such as `ScatterplotLayerOp`

### Editor Interactions

| Event | Properties | Location |
|-------|-----------|----------|
| `field_value_changed` | `fieldType, operatorType, source` (a comment edit is `operatorType: 'CommentOp'`, `source: 'node'`; the text isn't sent) | field-edit-analytics.tsx (from property-history.ts commitChange) |
| `panel_toggled` | `panel, visible` | layout.tsx, timeline-editor.tsx, top-menu-bar.tsx |
| `map_mode_changed` | `mode` | layout.tsx, top-menu-bar.tsx |
| `map_interacted` | `kind` | editor-analytics.ts (from timeline-editor.tsx) |
| `map_feature_clicked` | `operatorType, selected` | map-click-to-edit.tsx |
| `chat_opened` | `source` | top-menu-bar.tsx, noodles.tsx |
| `chat_closed` | `source` | top-menu-bar.tsx, noodles.tsx |

- `field_value_changed` counts edits the user commits in a field's control, at the same point an undo step is recorded, and only when a value changed. Project loads, keyframe playback, upstream connections, undo/redo and AI modifications set values without a commit, so they are not counted. Commits to the same field less than 1 second apart are one edit and send one event after a second of quiet, so dragging a slider or typing sends one event, not one per frame or keystroke.
- `fieldType`: the field's type (`number`, `color`, `boolean`, `string-literal`, `code`, ...), or `custom` for a node's own controls such as histogram brushes. `operatorType`: the node type (`ScatterplotLayerOp`). `source`: `node` or `properties_panel`. The value, field name, node id and code are never sent.
- `panel`: `sidebar`, `properties`, `timeline` or `spreadsheet`. The sidebar and properties panel are tracked when a resize makes them appear or disappear (dragging the separator, the sidebar chevron, Cmd+F); the timeline when its tab or collapse button is clicked; the spreadsheet from Editor > Show spreadsheet. The timeline opening by itself for an animated project is not counted.
- `mode`: `docked`, `floating` or `underlay` (the map behind the node graph)
- `map_interacted` fires once per page load for each `kind`: `pan`, `zoom` or `rotate` (rotate includes pitch). Only user gestures count: deck's controller interaction state, or MapLibre events that carry the input event that caused them. Camera keyframes and programmatic camera moves are not counted.
- `map_feature_clicked` fires when a click on the map lands on a feature, after the layer's own `onClick` (if any) passed on it. `selected` is true when the editor found the node that drew the feature and selected it; `operatorType` is that node's type (`ScatterplotLayerOp`), or `unknown` for a layer no node drew. Drags, clicks on empty map, and clicks while a map tool is armed, during an export, or with `?externalControl=true` are not counted. No ids, coordinates or feature data are sent.
- `chat_opened` `source`: `toolbar` (the top bar's Assistant button) or `quick_start` (the Quick Start dialog's AI path). `chat_closed` `source`: `toolbar` (the same button, labeled Hide while the assistant is open) or `panel` (the panel's own close button).

### Rendering and Export

Tracked in the renderer, not the buttons, so the Export button, the render settings panel and the `export_video` agent tool are each counted once. Every `render_started` is followed by exactly one of `render_completed`, `render_failed` or `render_cancelled`.

| Event | Properties | Location |
|-------|-----------|----------|
| `render_started` | `source, format, codec, captureMode, resolution, frameCount` | render-analytics.ts |
| `render_completed` | started properties + `durationMs` | render-analytics.ts |
| `render_failed` | started properties + `durationMs, errorCategory, errorName, framesDone` | render-analytics.ts |
| `render_cancelled` | started properties + `durationMs` | render-analytics.ts |
| `screenshot_taken` | `source` | renderer.ts (captureScreenshot) |

- `source`: `menu` (the logo menu and the Out node's panel), `toolbar` (the top bar's Export button) or `agent` (the `export_video` tool)
- `format`: `mp4`, `webm` (a transparent video), `png_sequence`, or `exr_sequence`; `codec` (`avc`, `hevc`, `vp9`, `av1`) is sent for `mp4` and `webm` only
- `captureMode`: `final` (waits for each frame to settle) or `preview` (captures on the first render, may drop frames)
- `resolution`: a bucket by the short side (`under_720p`, `720p`, `1080p`, `1440p`, `4k`, `8k`), not exact dimensions
- `durationMs`: wall time from the end of the save dialog to the end of the render
- `errorCategory`: `unsupported_codec`, `frame`, `encoder`, `canvas_replaced` (the recorded canvas was rebuilt mid-export, e.g. by adding or removing the basemap), `timeout` (a frame took too long to draw or read) or `exception`. `errorName` is the error class or DOMException name (`NotAllowedError`). The error message is never sent, since it can contain file paths.

The agent's `capture_visualization` tool is not a `screenshot_taken`: it returns the image to the model rather than saving a file.

### Data Import

When a CSV or JSON table is imported, the editor looks for coordinate columns so it can build a map without the AI assistant. `coordinates_detected` records whether that worked.

| Event | Properties | Location |
|-------|-----------|----------|
| `coordinates_detected` | `source, fileFormat, detected, method, reason, sizedByColumn, rowCountBucket` | use-file-import.ts |
| `quick_start_create_from_file` | `fileSize, mode, detected` | quick-start-modal.tsx |
| `quick_start_file_action_handled` | `mode` | noodles.tsx |

- `source`: `canvas_drop`, `quickstart` or `tools_shelf` (the Import Data dialog)
- `method`: `lat_lng`, `geometry` (a WKT or GeoJSON column) or `none`; `reason` is set only for `none`: `no_rows`, `no_columns` or `out_of_range` (columns named like coordinates whose values aren't longitude and latitude)
- `sizedByColumn`: whether points were sized by a numeric column
- `rowCountBucket`: `0`, `1-99`, `100-999`, `1k-10k`, `10k-100k` or `100k+`, never the exact count
- `mode`: `map` or `chat`. Both import the file into a new project; `chat` also opens the AI assistant. Before October 2026, `chat` opened an example without importing the file.
- Column names, values and file names are never sent

### User Interface

| Event | Properties | Location |
|-------|-----------|----------|
| `analytics_consent_granted` | - | analytics.ts (setConsent) |
| `analytics_consent_denied` | - | analytics.ts (setConsent) |
| `analytics_enabled_in_settings` | - | settings-dialog.tsx |
| `agent_prompt_copied` | `agent` (`claude_code`, `other`), `source` (`assistant_onboarding`), `withRequest` (whether the prompt carried the user's question; never its text) | assistant-onboarding.tsx |
| `webllm_model_selected` | `model` (a public WebLLM model id), `source` (`assistant_onboarding`, absent from Settings) | assistant-onboarding.tsx, settings-dialog.tsx |
| `key_prompt_answered` | `key` (`mapbox`, `googleMaps`, `cesium`), `kind` (`choose`, `overridden`, `rejected`), `source` (`project`, `browser`, `env`) | key-prompts.tsx |
| `key_prompt_dismissed` | `key`, `kind` | key-prompts.tsx |

The website's "Use with your AI agent" section sends `agent_prompt_copied` too, with `agent` and `location: 'landing'`, through the site's own PostHog and GA tags (`website/src/components/AgentQuickStart`). Before October 2026 both sent `claude_code_prompt_copied`. The prompt text itself is never sent.

### AI Assistant

| Event | Properties | Location |
|-------|-----------|----------|
| `ai_provider_load` | `provider, model, outcome` | chat-panel.tsx |
| `assistant_onboarding_shown` | `hasPendingRequest` | chat-panel.tsx |
| `assistant_onboarding_closed` | `hasPendingRequest` | chat-panel.tsx |

- `outcome`: `success` or `failed`. A failed on-device load is usually GPU memory or a missing WebGPU adapter; the error message is never sent.
- `assistant_onboarding_shown` fires each time the panel opens with no provider ready. `assistant_onboarding_closed` fires when its Close button is used, which is only shown before a provider is connected.
- `hasPendingRequest`: whether the panel opened with a request from the Quick Start dialog still unsent. The request text is never sent.

### App Updates

A tab opened before a deploy asks for code-split chunks that no longer exist, so lazy imports such as the chat panel fail. `stale-chunk.ts` decides what to do once per page load.

| Event | Properties | Location |
|-------|-----------|----------|
| `stale_chunk_reload` | `action` | stale-chunk.ts |

- `action`: `reloaded` (no unsaved work, so the page reloaded), `prompted` (the editor's unsaved-changes guard was armed, or sessionStorage is blocked so the 10-second reload guard cannot be stored; a message asked the user to save and reload) or `skipped` (the page already reloaded for this in the last 10 seconds, so the chunk is missing rather than stale)
- The chunk URL and the error message are never sent

### Performance

| Event | Properties | Location |
|-------|-----------|----------|
| `web_vital_measured` | `name, value, rating` | reportWebVitals.ts |

### Error Tracking

Errors are tracked for all users regardless of consent to maintain application stability.

| Event | Properties | Location |
|-------|-----------|----------|
| `$exception` | `source, componentStack` | index.tsx (React 19 error hooks) |

Error sources:
- `react_error_boundary` - Errors caught by an Error Boundary
- `react_uncaught` - Errors not caught by any Error Boundary
- `react_recoverable` - Errors React automatically recovered from

## Adding New Tracking

### Basic Usage

```typescript
import { analytics } from '../utils/analytics'

// Simple event (sent to both PostHog and Google Analytics)
analytics.track('feature_used')

// Event with properties (sent to both PostHog and Google Analytics)
analytics.track('render_started', {
  codec: 'h264',
  resolution: '1920x1080'
})
```

**Note:** All events are automatically sent to both PostHog and Google Analytics when users have consented. No need to call multiple tracking methods.

### Sensitive Data is Auto-Filtered

These properties are automatically removed:
- `projectName`, `fileName`, `nodeId`, `nodeData`, `nodeValue`
- `query`, `code`, `prompt`, `response`, `message`, `content`
- `apiKey`, `token`, `secret`, `key`, `password`
- `username`, `email`, `url`, `path`, `filePath`

### Optional Future Tracking

#### AI Chat Operations (`src/ai-chat/chat-panel.tsx`)

```typescript
import { analytics } from '../utils/analytics'

// Message sent
analytics.track('ai_message_sent', {
  messageLength: message.length
})

// Modifications applied
analytics.track('ai_modifications_applied', {
  count: modifications.length,
  success: true
})

// Errors
analytics.track('ai_error', {
  errorType: error.name || 'unknown'
})
```

#### User Interactions (`src/noodles/noodles.tsx`)

```typescript
import { analytics } from '../utils/analytics'

// Keyboard shortcuts
analytics.track('viewer_created', { method: 'keyboard' })
analytics.track('block_library_opened', { method: 'keyboard' })

// Node selection
analytics.track('node_selected')
```

#### Undo/Redo (`src/noodles/components/UndoRedoHandler.tsx`)

```typescript
import { analytics } from '../utils/analytics'

analytics.track('undo_performed')
analytics.track('redo_performed')
```

## Event Naming Conventions

- **Format**: `object_action` (e.g., `project_saved`, `node_deleted`)
- **Tense**: Past tense (`created`, `opened`, `failed`)
- **Case**: snake_case (`ai_panel_opened`)

## Privacy Guidelines

### Safe to Track ✅

- Feature usage (buttons, menus)
- Session duration
- Error types (not details)
- Performance metrics
- Browser/OS (anonymized by PostHog)

### Never Track ❌

- Project names or file names
- Node data or configuration values
- User code, queries, or prompts
- API keys or credentials
- Screenshots or visualizations
- Personal information
- IP addresses

## Testing

### Development Mode

1. Set environment variables in `.env.local` (both PostHog and GA keys)
2. Run `npm start`
3. Accept analytics consent
4. Perform actions
5. View events in:
   - PostHog Live Events
   - Google Analytics Realtime view
   - Browser DevTools Console (if debug logging enabled)

### Debug Logging

Enable verbose logging in `src/utils/analytics.ts`:

```typescript
if (import.meta.env.DEV) {
  posthog.debug(true)  // Change false to true
}
```

For Google Analytics, check the browser console for `gtag` calls or use the GA Debug Mode extension.

### Test Checklist

- [ ] Consent banner shows on first visit
- [ ] Consent persists in localStorage
- [ ] Settings toggle works
- [ ] Events fire when enabled
- [ ] No events fire when disabled
- [ ] App works when PostHog blocked
- [ ] Sensitive data filtered from events

## Dashboard Setup

### Recommended PostHog Insights

1. **Feature Usage** - Event counts over time
2. **User Journey Funnels** - Project creation → Save → Export
3. **Retention** - Daily/weekly active users
4. **Performance** - Web Vitals trends

### Example Queries

```sql
-- Most popular node types
SELECT properties.nodeType, count()
FROM events
WHERE event = 'node_added'
GROUP BY properties.nodeType
ORDER BY count() DESC

-- Render success rate
SELECT
  countIf(event = 'render_completed') /
  countIf(event = 'render_started') * 100 as success_rate
FROM events
```

## GDPR Compliance

The implementation is GDPR-compliant:

- ✅ Clear consent before tracking
- ✅ Easy opt-out mechanism
- ✅ Data minimization
- ✅ No cookies (uses localStorage)
- ✅ Transparent about collection

## Troubleshooting

### Analytics not initializing

- Check `VITE_POSTHOG_API_KEY` and `VITE_GA_MEASUREMENT_ID` are set
- Check browser console for errors
- Verify analytics providers aren't blocked by ad blockers
- Both providers will gracefully fail if blocked without breaking the app

### Events not showing

**PostHog:**
- Ensure user has accepted consent
- Check `analytics.isEnabled()` returns `true`
- Verify API key is correct
- Check PostHog Live Events view

**Google Analytics:**
- Ensure user has accepted consent
- Check browser console for `gtag` calls
- Verify Measurement ID is correct
- Check Google Analytics Realtime view

### Measuring opt-out rates

Both `analytics_consent_granted` and `analytics_consent_denied` events are tracked. The denied event is sent once before disabling tracking, allowing you to measure how many users opt out.

### App breaks when analytics blocked

This shouldn't happen! All analytics calls are wrapped in try-catch blocks. If you see errors:

1. Check error boundaries are working
2. Verify all `analytics.track()` calls are try-catch wrapped
3. Check `analytics.initialize()` error handling for both providers

## Related Documentation

- [Privacy Policy](../docs/privacy-policy.md) - User-facing privacy information
- [Architecture](./architecture.md) - System architecture overview
- [Developing](./developing.md) - Development guidelines
