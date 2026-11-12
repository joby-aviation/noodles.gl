# API Keys Configuration

Some nodes and tools call outside services that need a key. Enter keys in **App Settings → API Keys** (the gear icon in the top menu bar).

## Supported Keys

| Key | Used by |
|-----|---------|
| Mapbox Access Token | Geocoder node, driving directions, place search in the Create Point tool |
| Google Maps API Key | Traffic-aware driving and transit directions, place search in the Create Point tool, Google 3D tiles in a Tile 3D Layer |
| Cesium Ion Access Token | Cesium Ion tilesets in a Tile 3D Layer (not needed for a custom tileset URL) |
| Anthropic API Key | The [AI assistant](./ai-assistant.md) |
| OpenRouter API Key | The [AI assistant](./ai-assistant.md) through OpenRouter |

- **Mapbox**: create a token at [mapbox.com](https://www.mapbox.com/). Without one, driving directions use OSRM, and without a Mapbox or Google key place search uses Photon; both are free and based on OpenStreetMap.
- **Google Maps**: enable the Maps JavaScript API, Routes API and Places API in the [Google Cloud Console](https://console.cloud.google.com/).
- **Anthropic and OpenRouter**: see the [AI Assistant guide](./ai-assistant.md).

## Key Sources

A key can come from three places, used in this order:

1. **Project**: saved in the project file, so everyone who opens the project uses it
2. **Browser**: saved in this browser (localStorage) for all your projects
3. **Environment**: set by environment variables when the app is built

App Settings → API Keys shows each source and marks the one in use as **Active**. To use your own key instead of the project's, click **Use** next to it. The choice applies to this project in this browser only, and if the project's key changes, the project's key is used again.

When you open a project whose Mapbox, Google Maps or Cesium Ion key differs from your own, a prompt asks which to use. **Keep** uses the project's key and stops asking; **Use mine** switches to yours. While your key is in use, a prompt says so and offers the project's key back. If Google rejects the project's key on this site, the prompt offers yours instead. **Dismiss** hides a prompt until you reload the page.

Nodes that use a key run again with the new key once you stop typing it or switch keys. Google search and directions keep the key they first loaded with, so reload the page after switching that one. Browser keys and choices made in another tab apply in this one too.

When a service rejects a key, the error says which one, for example "Google rejected the project's Google Maps key (REQUEST_DENIED)", so you know whether to fix the project's key or your own.

## Privacy and Security

Keys are never sent to Noodles.gl servers.

### Sharing projects with keys

To give a project its own key, enter it in the **Project** field and save the project. The key is stored in plain text in `noodles.json`, so share projects that contain keys only with people you trust. Your browser keys are never saved in a project file.

### AI keys stay out of project files

Anthropic and OpenRouter keys come only from the browser or the environment. They are never saved in a project file, and a key found in one is never used: the AI assistant sends your messages and graph to the provider, so a key from someone else's project would route your conversation through their account, and a saved key would give your account to anyone you share the project with.

If a project file you open contains an AI key, App Settings → API Keys says so. The key is ignored and is removed from the file the next time you save.

## Environment Variables

For development or CI, set keys as environment variables:

```bash
VITE_MAPBOX_ACCESS_TOKEN=your_token_here
VITE_GOOGLE_MAPS_API_KEY=your_key_here
VITE_CESIUM_ACCESS_TOKEN=your_token_here
VITE_CLAUDE_API_KEY=your_key_here
VITE_OPENROUTER_API_KEY=your_key_here
```

They are read at build time and bundled into the app, so anyone who can load that build can read them.
