# Analytics Tracking - Optional Additions

These are optional tracking implementations you can add later to get deeper insights into feature usage.

## Already Implemented ✅

- [x] Analytics utility with privacy-first design
- [x] Consent banner on first visit
- [x] Settings dialog with analytics toggle
- [x] Project operations (new, save, open, export)
- [x] Node operations (add, delete nodes/edges)
- [x] Web Vitals performance tracking

## Optional Future Additions

### 1. Render Operations

**File**: `src/render/renderer.ts`

**Where to add tracking**:

```typescript
// Add import at top
import { analytics } from '../utils/analytics'

// In startCapture() function, after render starts
analytics.track('render_started', {
  codec: codec,
  resolution: `${width}x${height}`
})

// When render completes successfully
analytics.track('render_completed', {
  duration: elapsedSeconds,
  frameCount: totalFrames
})

// If render is cancelled
analytics.track('render_cancelled')

// In captureScreenshot() function
analytics.track('screenshot_captured')
```

### 2. AI Chat Operations

**File**: `src/ai-chat/chat-panel.tsx`

**Where to add tracking**:

```typescript
// Add import at top
import { analytics } from '../utils/analytics'

// When chat panel is toggled (in noodles.tsx, button onClick)
analytics.track('ai_panel_opened')
analytics.track('ai_panel_closed')

// In handleSend() function, after sending message
analytics.track('ai_message_sent', {
  messageLength: message.length
})

// When AI suggests modifications
analytics.track('ai_modifications_suggested', {
  count: modifications.length
})

// When modifications are successfully applied
analytics.track('ai_modifications_applied', {
  count: modifications.length,
  success: true
})

// On error
analytics.track('ai_error', {
  errorType: error.name || 'unknown'
})
```

### 3. User Interactions

**File**: `src/noodles/noodles.tsx`

**Where to add tracking**:

```typescript
// Add import at top
import { analytics } from '../utils/analytics'

// In the keyboard event handler for 'v' key (create viewer)
analytics.track('viewer_created', {
  method: 'keyboard'
})

// In the keyboard event handler for 'a' key (block library)
analytics.track('block_library_opened', {
  method: 'keyboard'
})

// When user selects a node
analytics.track('node_selected')

// On route changes (if tracking navigation)
analytics.track('route_changed', {
  path: location.pathname
})
```

### 4. Undo/Redo Operations

**File**: `src/noodles/components/UndoRedoHandler.tsx`

**Where to add tracking**:

```typescript
// Add import at top
import { analytics } from '../../utils/analytics'

// In the undo handler
analytics.track('undo_performed')

// In the redo handler
analytics.track('redo_performed')
```

### 5. Error Tracking

**Create a new error boundary** or add to existing error handlers:

```typescript
import { analytics } from './utils/analytics'

// When errors occur
analytics.track('error_occurred', {
  errorType: error.name,
  context: 'storage' // or 'ai', 'render', etc.
})

// Storage errors
analytics.track('storage_error', {
  errorType: error.type,
  storageType: storageType
})
```

### 6. App Lifecycle Events

**File**: `src/index.tsx` or `src/app.tsx`

```typescript
// Track when app loads
analytics.track('app_loaded')

// Track when user leaves (optional)
window.addEventListener('beforeunload', () => {
  analytics.track('app_closed')
})
```

## Event Naming Convention

Follow this pattern for consistency:

- **Object_Action**: `project_saved`, `node_deleted`, `render_completed`
- Use past tense: `created`, `opened`, `failed` (not `create`, `open`, `fail`)
- Use snake_case: `ai_panel_opened` (not `aiPanelOpened`)

## Properties Best Practices

### Good Properties ✅

```typescript
analytics.track('render_started', {
  codec: 'h264',
  resolution: '1920x1080',
  duration: 30
})
```

### Bad Properties ❌

```typescript
analytics.track('render_started', {
  projectName: 'My Secret Project',  // NEVER include project names
  nodeData: {...},                    // NEVER include node data
  query: 'user query'                 // NEVER include user input
})
```

## Testing Your Implementation

1. **Enable debug mode** in `src/utils/analytics.ts`:
   ```typescript
   posthog.debug(true)
   ```

2. **Check browser console** for PostHog events

3. **Verify in PostHog dashboard**:
   - Go to https://app.posthog.com
   - Click "Live events"
   - Perform actions in your app
   - See events appear in real-time

4. **Test consent flow**:
   - Clear localStorage: `localStorage.clear()`
   - Reload app
   - Should see consent banner
   - Accept/decline and verify events fire (or don't)

5. **Test opt-out**:
   - Open Settings
   - Disable analytics
   - Perform actions
   - Verify no events are sent

## Dashboard Setup

### Recommended Insights in PostHog

1. **Feature Usage**:
   - Most used features (event counts)
   - Feature adoption over time

2. **User Journey Funnels**:
   - Project creation → Save → Export
   - App load → Node added → Project saved

3. **Retention**:
   - Daily/weekly active users
   - Feature stickiness

4. **Performance**:
   - Web Vitals trends
   - Render times

### Example Dashboard Queries

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

-- Daily active users
SELECT
  toDate(timestamp) as date,
  uniq(distinct_id) as users
FROM events
GROUP BY date
ORDER BY date DESC
```

## Privacy Checklist

Before deploying any new tracking:

- [ ] No project names or file names
- [ ] No node data or values
- [ ] No user queries or prompts
- [ ] No API keys or secrets
- [ ] No personally identifiable information
- [ ] Properties are aggregatable (types, counts, not IDs)
- [ ] Respects user's consent choice
- [ ] Document in ANALYTICS.md

## Support

If you need help implementing any of these:

1. Check the PostHog docs: https://posthog.com/docs
2. Review the existing implementations in this codebase
3. Test locally before deploying
4. Monitor the free tier limits (1M events/month)
