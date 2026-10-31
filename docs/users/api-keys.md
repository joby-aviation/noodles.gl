# API Keys Configuration

Configure API keys for external services used by Noodles.gl. Access settings via the gear icon in the top menu bar.

## Key Sources

A key can come from three places, used in this order:
1. **Project** - Saved in the project file, so everyone who opens the project uses it
2. **Browser** - Saved in this browser for all your projects
3. **Environment** - Set via environment variables

App Settings → API Keys shows each source and marks the one in use as **Active**. To use your own key instead of the project's, click **Use** next to it. The choice applies to this project in this browser only. If the project's key changes, the project's key is used again.

When you open a project whose Mapbox, Google Maps or Cesium Ion key differs from your own, a prompt asks which to use. **Keep** uses the project's key and stops asking, and **Use mine** switches to yours. While your key is in use, a prompt says so and offers the project's key back. If Google rejects the project's key on this site, the prompt offers your key instead. Google search and directions keep the key they first loaded with, so reload the page after switching that key. **Dismiss** hides a prompt until you reload the page.

Nodes that use a key, such as Geocoder, Directions and Tile 3D Layer, run again with the new key once you stop typing it or switch to another key. Browser keys and choices made in another tab apply in this one too.

AI provider keys (Anthropic and OpenRouter) are the exception: they come only from the browser or the environment, never from a project file. See [AI keys stay out of project files](#ai-keys-stay-out-of-project-files).

## Supported Keys

| Key | Purpose | Required For |
|-----|---------|--------------|
| Mapbox Access Token | Basemaps, directions | Mapbox styles in the deck node's Map style URL |
| Google Maps API Key | Places and routing | Create Point wizard, traffic-aware driving, transit directions |
| Anthropic API Key | Claude AI assistant | [AI chat features](./ai-assistant.md) |
| OpenRouter API Key | AI assistant via OpenRouter | [AI chat features](./ai-assistant.md) |

### Mapbox Access Token

Used for Mapbox basemap styles and routing directions. Create a free account at [mapbox.com](https://www.mapbox.com/) to obtain a token.

### Google Maps API Key

Required for the Create Point geocoding wizard, traffic-aware driving, and transit directions. Enable the Maps JavaScript API, Routes API, and Places API in the [Google Cloud Console](https://console.cloud.google.com/).

### Anthropic API Key

Powers the in-app AI assistant. See the [AI Assistant guide](./ai-assistant.md) for detailed setup instructions.

## Privacy and Security

API keys are stored locally and never sent to Noodles.gl servers. Browser keys are stored in localStorage. 

### Sharing Projects with Keys

To give a project its own key, enter it in the **Project** field in App Settings and save the project. The key is stored in plain text in `noodles.json`, so only share projects containing keys with trusted collaborators. Your browser keys are never saved in a project file.

### AI keys stay out of project files

Anthropic and OpenRouter keys are never saved in a project file, and a key found in a project file is never used. The AI assistant sends your messages and graph to the provider, so a key from someone else's project would route your conversation through their account, and a saved key would give your account to anyone you share the project with.

If a project file you open contains an AI key, App Settings → API Keys says so. The key is ignored and is removed from the file the next time you save.

## Environment Variables

For development or CI/CD, set keys via environment variables:

```bash
VITE_MAPBOX_ACCESS_TOKEN=your_token_here
VITE_GOOGLE_MAPS_API_KEY=your_key_here
VITE_CLAUDE_API_KEY=your_key_here
VITE_OPENROUTER_API_KEY=your_key_here
```

These are read at build time and bundled into the application.
