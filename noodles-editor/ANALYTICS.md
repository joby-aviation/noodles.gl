# PostHog Analytics Integration

This document describes the privacy-preserving analytics integration in Noodles.gl.

## Overview

We use PostHog for product analytics to understand which features are most useful to users. The implementation is **privacy-first** with the following principles:

- **Opt-in by default**: Users must explicitly consent before any data is collected
- **No sensitive data**: We never track project names, node data, code, queries, or API keys
- **Manual events only**: No automatic capture or session recording
- **Easy opt-out**: Users can disable analytics anytime in Settings

## Setup

### Environment Variables

Add to your `.env.local` file (see `.env.local.example`):

```env
VITE_POSTHOG_API_KEY=your-project-key-here
VITE_POSTHOG_HOST=https://app.posthog.com  # Optional, defaults to US cloud
```

### Getting a PostHog API Key

1. Sign up at https://posthog.com (free tier: 1M events/month)
2. Create a new project
3. Copy your Project API Key from Project Settings
4. Add it to your `.env.local` file

## Architecture

### Core Files

- **`src/utils/analytics.ts`**: Analytics manager singleton with consent management and data filtering
- **`src/components/analytics-consent-banner.tsx`**: First-visit consent banner
- **`src/components/settings-dialog.tsx`**: Settings UI with analytics toggle
- **`src/index.tsx`**: Analytics initialization
- **`src/reportWebVitals.ts`**: Web Vitals tracking

### Key Features

1. **Consent Management**: Uses localStorage to persist user preferences
2. **Data Filtering**: Automatically removes sensitive properties before sending
3. **Privacy-First Initialization**: PostHog initialized with:
   - `opt_out_capturing_by_default: true`
   - `autocapture: false`
   - `session_recording: false`
   - `capture_pageview: false`

## Tracked Events

### Project Operations

| Event | Properties | Location |
|-------|-----------|----------|
| `project_created` | `method: 'new' \| 'import'` | menu.tsx |
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

## Adding More Tracking

To add tracking for additional features:

### 1. Import the analytics utility

```typescript
import { analytics } from '../utils/analytics'
```

### 2. Track events

```typescript
// Simple event
analytics.track('feature_used')

// Event with properties
analytics.track('render_started', {
  codec: 'h264',
  resolution: '1920x1080',
  fps: 30
})
```

### 3. Sensitive Data is Auto-Filtered

The following properties are automatically removed:
- projectName, fileName, nodeId, nodeData, nodeValue
- query, code, prompt, response, message, content
- apiKey, token, secret, key, password
- username, email, url, path, filePath

## Recommended Additional Tracking

Here are suggested events for key features:

### Render Operations (renderer.ts)

```typescript
// When render starts
analytics.track('render_started', {
  codec: codecType,
  resolution: `${width}x${height}`,
  fps: frameRate
})

// When render completes
analytics.track('render_completed', {
  duration: totalDuration,
  frameCount: totalFrames
})

// When render is cancelled
analytics.track('render_cancelled', {
  progress: percentComplete
})

// When screenshot is captured
analytics.track('screenshot_captured')
```

### AI Operations (chat-panel.tsx)

```typescript
// When AI panel is opened
analytics.track('ai_panel_opened')

// When user sends a message
analytics.track('ai_message_sent', {
  messageLength: message.length  // Don't send actual message
})

// When AI suggests modifications
analytics.track('ai_modifications_suggested', {
  count: modifications.length
})

// When user applies AI modifications
analytics.track('ai_modifications_applied', {
  count: modifications.length,
  success: true
})

// On AI error
analytics.track('ai_error', {
  errorType: error.type
})
```

### User Interactions (noodles.tsx)

```typescript
// When user creates a viewer with 'v' key
analytics.track('viewer_created', {
  method: 'keyboard'
})

// When block library is opened with 'a' key
analytics.track('block_library_opened', {
  method: 'keyboard'
})

// On route change
analytics.track('route_changed', {
  path: newPath
})
```

### Undo/Redo (UndoRedoHandler.tsx)

```typescript
// When user undoes
analytics.track('undo_performed')

// When user redoes
analytics.track('redo_performed')
```

## Testing Analytics

### In Development

1. Set environment variables in `.env.local`
2. Run the app: `npm run dev`
3. Open browser console
4. Accept analytics in the consent banner
5. Perform actions and verify events in PostHog's Live Events view

### Debugging

Enable verbose logging in development:

```typescript
// In src/utils/analytics.ts, change:
if (import.meta.env.DEV) {
  posthog.debug(true)  // Change false to true
}
```

## Privacy Considerations

### What We Track
- Feature usage (which buttons/menus are used)
- Error occurrences (types, not details)
- Performance metrics (web vitals)
- Session duration
- Browser/OS information (automatic, anonymized)

### What We DON'T Track
- Project names or file names
- Node data or configuration values
- User code, queries, or prompts
- API keys or credentials
- Screenshots or visualizations
- Personal information (emails, names)
- IP addresses (PostHog anonymizes these)

### GDPR Compliance

The implementation is GDPR-compliant:
- ✅ Clear consent before tracking
- ✅ Easy opt-out mechanism
- ✅ Data minimization (only necessary data)
- ✅ No cookies (PostHog uses localStorage)
- ✅ Transparent about what's collected

## User-Facing Documentation

Consider adding this to your website/README:

> **Privacy & Analytics**: Noodles.gl uses privacy-preserving analytics to understand which features are most useful. We never collect your project data, node content, or personal information. You can opt-out anytime in Settings.

## Maintenance

### Updating PostHog

```bash
yarn upgrade posthog-js
```

### Monitoring Usage

1. Log into PostHog dashboard
2. View:
   - Live events
   - Insights (custom dashboards)
   - Funnels (user journeys)
   - Retention (returning users)

### Best Practices

1. **Review tracked events quarterly** - Remove unused events
2. **Monitor event volume** - Stay within free tier limits
3. **Test new tracking** - Verify events in dev before deploying
4. **Document custom events** - Update this file when adding tracking
5. **Respect user privacy** - Always filter sensitive data

## Support

- PostHog Docs: https://posthog.com/docs
- PostHog Community: https://posthog.com/questions
- Open an issue in this repo for implementation questions
