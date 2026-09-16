# API Keys Configuration

Configure API keys for external services used by Noodles.gl. Access settings via the gear icon in the top menu bar.

## Key Sources

Keys are resolved in priority order:
1. **Browser** - Stored in localStorage, persists across sessions
2. **Project** - Loaded from and retained in the project file until explicitly removed
3. **Environment** - Set via environment variables

The first source with a valid key is used automatically.

## Supported Keys

| Key | Purpose | Required For |
|-----|---------|--------------|
| Mapbox Access Token | Basemaps, directions | MaplibreBasemapOp with Mapbox styles |
| Google Maps API Key | Places geocoding | Create Point wizard, DirectionsOp |
| Anthropic API Key | Claude AI assistant | [AI chat features](./ai-assistant.md) |

### Mapbox Access Token

Used for Mapbox basemap styles and routing directions. Create a free account at [mapbox.com](https://www.mapbox.com/) to obtain a token.

### Google Maps API Key

Required for the Create Point geocoding wizard and DirectionsOp. Enable the Places API in the [Google Cloud Console](https://console.cloud.google.com/).

### Anthropic API Key

Powers the in-app AI assistant. See the [AI Assistant guide](./ai-assistant.md) for detailed setup instructions.

## Privacy and Security

API keys are stored locally and never sent to Noodles.gl servers. Browser keys are stored in localStorage. 

### Sharing Projects with Keys

Enabling **Add browser keys to this project** copies them into `noodles.json`, where they are stored in plain text and travel with the project. Only share projects containing keys with trusted collaborators. Loaded project keys remain in subsequent saves until removed from App Settings.

## Environment Variables

For development or CI/CD, set keys via environment variables:

```bash
VITE_MAPBOX_ACCESS_TOKEN=your_token_here
VITE_GOOGLE_MAPS_API_KEY=your_key_here
VITE_CLAUDE_API_KEY=your_key_here
```

These are read at build time and bundled into the application.
