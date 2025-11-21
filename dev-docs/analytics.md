# Analytics Integration

Privacy-preserving product analytics using PostHog to understand feature usage and improve the Noodles.gl editor.

## Overview

Noodles.gl uses PostHog for product analytics with a privacy-first approach:

- **Opt-in by default**: Users must explicitly consent before data collection
- **No sensitive data**: Never tracks project names, node data, code, queries, or API keys
- **Manual events only**: No automatic capture or session recording
- **Easy opt-out**: Users can disable anytime in Settings
- **Ad-blocker resilient**: Gracefully handles blocking without breaking the app

## Setup

### Environment Variables

Add to `.env.local` (see `.env.local.example`):

```env
VITE_POSTHOG_API_KEY=phc_your_key_here
VITE_POSTHOG_HOST=https://app.posthog.com  # Optional
```

### Getting a PostHog API Key

1. Sign up at https://posthog.com (free tier: 1M events/month)
2. Create a new project
3. Copy Project API Key from Project Settings
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
3. **Error Handling** - Try-catch blocks around all PostHog calls
4. **Error Boundary** - Catches analytics component failures
5. **Privacy Configuration**:
   - `opt_out_capturing_by_default: true`
   - `autocapture: false`
   - `disable_session_recording: true`
   - `capture_pageview: false`

## Currently Tracked Events

### Project Operations

| Event | Properties | Location |
|-------|-----------|----------|
| `project_created` | `method` | menu.tsx |
| `project_imported` | - | menu.tsx |
| `project_saved` | `storageType, isFirstSave` | menu.tsx |
| `project_save_failed` | `storageType, error` | menu.tsx |
| `project_exported` | `storageType` | menu.tsx |
| `project_opened` | `storageType` | menu.tsx |
| `project_open_failed` | `storageType, error` | menu.tsx |

### Node Operations

| Event | Properties | Location |
|-------|-----------|----------|
| `node_added` | `nodeType` | use-project-modifications.ts |
| `node_deleted` | `count` | use-project-modifications.ts |
| `edge_added` | `count` | use-project-modifications.ts |
| `edge_deleted` | `count` | use-project-modifications.ts |

### User Interface

| Event | Properties | Location |
|-------|-----------|----------|
| `analytics_consent_accepted` | - | analytics-consent-banner.tsx |
| `analytics_enabled_in_settings` | - | settings-dialog.tsx |

### Performance

| Event | Properties | Location |
|-------|-----------|----------|
| `web_vital_measured` | `name, value, rating` | reportWebVitals.ts |

## Adding New Tracking

### Basic Usage

```typescript
import { analytics } from '../utils/analytics'

// Simple event
analytics.track('feature_used')

// Event with properties
analytics.track('render_started', {
  codec: 'h264',
  resolution: '1920x1080'
})
```

### Sensitive Data is Auto-Filtered

These properties are automatically removed:
- `projectName`, `fileName`, `nodeId`, `nodeData`, `nodeValue`
- `query`, `code`, `prompt`, `response`, `message`, `content`
- `apiKey`, `token`, `secret`, `key`, `password`
- `username`, `email`, `url`, `path`, `filePath`

### Optional Future Tracking

#### Render Operations (`src/render/renderer.ts`)

```typescript
import { analytics } from '../utils/analytics'

// In startCapture()
analytics.track('render_started', {
  codec: codec,
  resolution: `${width}x${height}`
})

// When complete
analytics.track('render_completed', {
  duration: elapsedSeconds,
  frameCount: totalFrames
})

// If cancelled
analytics.track('render_cancelled')

// In captureScreenshot()
analytics.track('screenshot_captured')
```

#### AI Chat Operations (`src/ai-chat/chat-panel.tsx`)

```typescript
import { analytics } from '../utils/analytics'

// Panel toggle
analytics.track('ai_panel_opened')
analytics.track('ai_panel_closed')

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

1. Set environment variables in `.env.local`
2. Run `yarn start`
3. Accept analytics consent
4. Perform actions
5. View events in PostHog Live Events

### Debug Logging

Enable verbose logging in `src/utils/analytics.ts`:

```typescript
if (import.meta.env.DEV) {
  posthog.debug(true)  // Change false to true
}
```

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

- Check `VITE_POSTHOG_API_KEY` is set
- Check browser console for errors
- Verify PostHog isn't blocked by ad blockers

### Events not showing in PostHog

- Ensure user has accepted consent
- Check `analytics.isEnabled()` returns `true`
- Verify API key is correct
- Check PostHog Live Events view

### App breaks when PostHog blocked

This shouldn't happen! All PostHog calls are wrapped in try-catch blocks. If you see errors:

1. Check error boundary is working
2. Verify all `analytics.track()` calls are try-catch wrapped
3. Check `analytics.initialize()` error handling

## Related Documentation

- [Privacy Policy](../docs/privacy-policy.md) - User-facing privacy information
- [Architecture](./architecture.md) - System architecture overview
- [Developing](./developing.md) - Development guidelines
