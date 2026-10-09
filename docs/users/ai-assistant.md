# AI Assistant

The Noodles.gl AI Assistant helps you create geospatial visualizations, debug projects, and learn about operators through natural language conversation.

## Overview

The AI Assistant is an interactive chat interface that:

- Answers questions about operators and workflows
- Creates and modifies nodes in your visualization graph
- Debugs errors and suggests fixes
- Searches documentation and examples
- Finds relevant data sources and examples on the web

## Getting Started

### Opening the Chat Panel

Click the **AI Assistant** button in the main menu, or use the keyboard shortcut `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux).

### The fastest way in

Open the chat and click **Connect OpenRouter**. A small window opens, you approve, it closes, and you can ask a question. There is no key to copy and nothing to paste — the editor gets its own key and remembers it, so this happens once per browser.

OpenRouter's free tier runs to roughly 50 requests a day without adding credit, which is enough to try the assistant properly. Free models that support tool calling are listed first in the model picker; the assistant needs tools to read and change your graph, so the picker only offers models that have them.

Nothing downloads and nothing is charged.

### Other ways to connect

| Option | What it costs | Good for |
| --- | --- | --- |
| **Connect OpenRouter** | Free, one click | Getting started. Start here. |
| **Run a model locally** | A one-time download of 0.9–5.6 GB | Privacy, offline work, no account at all |
| **A free key from Groq, Google AI Studio or Cerebras** | Free, one signup, no card | An alternative if OpenRouter's daily cap is in the way |
| **Your own API key** | Whatever the provider charges | Best answers, hardest tasks |

All of these live in Settings → **AI Provider** (the gear icon in the chat header). Leave the provider on **Automatic** and the editor uses whichever you have set up, preferring the strongest one.

### Running a model locally

Settings → AI Provider → **Local model (on-device)**, then pick a model. Nothing downloads until you pick one — sizes are shown next to each name, from 0.9 GB for Llama 3.2 1B up to 5.6 GB for Qwen3 8B. Qwen3 4B (3.4 GB) is a good default.

The download happens once and shows a progress bar. After that the model is cached in your browser and starts immediately, and no prompt ever leaves your machine.

This needs a browser with WebGPU — Chrome or Edge 113+, or Safari 17+. If the option is greyed out, your browser does not offer it.

Local models are small. Expect them to answer questions about your graph and make single-step edits; they are not going to build a visualization from a sentence.

### Using your own API key

Settings → **API Keys**, or Settings → AI Provider for the endpoint options:

- **Anthropic** — a key from [console.anthropic.com](https://console.anthropic.com/), starting `sk-ant-`. The best answers available in the editor.
- **OpenRouter** — Connect handles this for you, but you can also paste a key.
- **Custom endpoint** — anything speaking the OpenAI chat-completions format. Presets fill in Groq, Google AI Studio, Cerebras and OpenAI; the first three hand out a free key with no card, and each preset links to the page that issues one. A server on your own machine (LM Studio, llama.cpp, Ollama) needs no key at all — just the address and the model name.

**Test and Save** checks the endpoint before storing it, so a mistyped address or model name is caught there rather than in the middle of a conversation.

Keys are stored in your browser and never sent to Noodles.gl. See [API Keys Configuration](./api-keys.md).

## Using the Assistant

### Asking Questions

Simply type your question in the chat input and press Enter. The assistant can help with:

**Learning about operators:**
- "What does the ScatterplotLayer do?"
- "How do I load a CSV file?"
- "What's the difference between ArcLayer and PathLayer?"

**Creating visualizations:**
- "Show me NYC bike share stations as a scatterplot"
- "Create a heatmap of earthquake data"
- "Draw flight routes between cities with arcs"

**Debugging:**
- "My visualization isn't showing up, can you help?"
- "I'm getting a 'data is undefined' error"
- "Why are my layers not rendering?"

**Finding examples:**
- "Show me an example of using DuckDB"
- "How do I create an animated path?"
- "Find examples of H3 hexagon layers"

### Tools the Assistant Can Use

The assistant has access to powerful tools to help you:

**Visual Debugging:**
- Capture screenshots of your visualization
- Check browser console for errors
- Inspect rendering performance and memory usage
- Examine individual layer properties

**Project Modification:**
- Add new operators to your graph
- Update operator inputs and settings
- Delete nodes and connections
- Create complete visualizations from scratch

**Data & Computation:**
- Run JavaScript against your live graph to compute a result
- List, read, and search your project's data files
- Write a derived dataset to `@/.agent/` and load it with a FileOp

**Documentation & Examples:**
- Search the Noodles.gl documentation
- Find relevant code examples
- Look up operator schemas and field types
- Explain how existing projects work

**Web Search:**
- Find data sources and APIs
- Search for tutorials and guides
- Look up Deck.gl and MapLibre documentation
- Find GeoJSON datasets and examples

### Example Conversations

**Example 1: Creating a Visualization**

> **You:** Show me earthquakes from the past week as a heatmap.
>
> **Assistant:** I'll help you create a heatmap of recent earthquakes. Let me search for the data source first.
>
> *[Searches web for USGS earthquake data]*
>
> **Assistant:** I found the USGS earthquake feed. Creating your visualization now...
>
> *[Creates FileOp to load data, adds HeatmapLayer]*
>
> **Assistant:** Done! I've created a heatmap showing 2,547 earthquakes from the past 7 days. The intensity represents magnitude. You can adjust the radius and intensity in the HeatmapLayer settings.

**Example 2: Debugging an Error**

> **You:** I'm getting an error and nothing is showing up.
>
> **Assistant:** Let me check your console for errors.
>
> *[Checks console errors]*
>
> **Assistant:** I found the issue - your PathLayer has an undefined data input. It looks like your FileOp failed to load because the URL is incorrect. The file should be `@/data.geojson` (relative to your project), not `/data.geojson` (absolute path).
>
> Would you like me to fix the URL?

## Settings

Click the gear icon (⚙️) in the chat panel header, or open Settings → **AI Provider**.

### Switching provider

The two dropdowns in the chat header are the quickest way: the first picks the provider, the second the model. Anything you have not set up is greyed out, and the gear beside them opens the full settings.

**Automatic** — the default — uses whichever provider you have configured, preferring the strongest: Anthropic, then OpenRouter, then a custom endpoint, then a local model, then Chrome's built-in one. A local model is only ever used if you picked one yourself, so nothing large is ever downloaded on your behalf. Pinning a provider that later loses its key falls back to the same order rather than breaking.

Your conversation history is preserved when switching.

### Model selection

The second dropdown lists what the current provider offers:

- **Anthropic** — Claude models.
- **OpenRouter** — free tool-capable models first, then paid ones. The list comes from OpenRouter, so it reflects what is actually free today.
- **Local model** — the five WebLLM models, with download sizes.
- **Custom endpoint** — the model you configured. After a successful test, the field suggests the models that endpoint reported.
- **Chrome built-in** — one model, so there is nothing to choose.

### Auto-capture screenshots

Sends a screenshot of your visualization with each message.

- Helpful for visual debugging
- Slower, and uses more of the model's context
- Can be triggered manually with the camera button instead


## Tips for Better Results

### Be Specific

**Instead of:** "Create a map"
**Try:** "Create a scatterplot showing NYC subway stations colored by line"

**Instead of:** "Fix my error"
**Try:** "I'm getting 'undefined data' in my PathLayer, can you help?"

### Break Down Complex Tasks

For large projects, work step-by-step:

1. "Load data from this CSV: [URL]"
2. "Filter to only show points in California"
3. "Create a heatmap of the filtered data"
4. "Add a dark basemap"

### Use Screenshots for Visual Issues

If something looks wrong visually, click the camera button to share a screenshot. The AI can see your visualization and provide better help.

### Match the Model to the Task

A local or built-in model is fine for questions about your graph and single-step edits. If one is taking too long or answering vaguely, switch to OpenRouter or Anthropic for the harder task rather than rephrasing at it.

## Troubleshooting

### "WebGPU not supported"

**Problem:** Your browser doesn't support WebGPU, which is required for the local model.

**Solutions:**
- Update your browser to the latest version (Chrome 113+, Edge 113+, Safari 17+)
- Click **Connect OpenRouter** instead — free, no download, and no key to paste
- Use a different device with a modern browser

### "Model download failed"

**Problem:** The model download was interrupted or failed.

**Solutions:**
- Check your internet connection
- Pick the model again in Settings → AI Provider to restart the download; finished parts are cached, so a retry resumes rather than starting over
- Clear your browser cache and try again
- Try a smaller model — Llama 3.2 1B is 0.9 GB
- If problems persist, click **Connect OpenRouter** instead

### Responses are very slow

**Problem:** The local model is taking 10+ seconds to respond.

**Causes:**
- Your device may not have enough GPU power
- Other tabs or applications are using GPU resources
- A long conversation: the whole transcript is re-read on every turn, and a local model has only a 4,096-token window to fit it in

**Solutions:**
- Close other tabs and applications
- Start a new conversation (➕ in the chat header) — a long transcript is slower on a small model
- Try a smaller local model, or switch to OpenRouter for faster responses
- Restart your browser

### "Out of memory" error

**Problem:** The browser ran out of memory while running the AI model.

**Solutions:**
- Close other tabs and applications
- Restart your browser
- Pick a smaller local model — Llama 3.2 1B needs about a quarter of the memory Qwen3 8B does
- Use OpenRouter or Anthropic instead; neither uses your device's memory

### AI gives incorrect or unhelpful answers

**Problem:** The response isn't helpful or contains mistakes.

**On a local or built-in model:**
- Break the task into smaller steps; these models handle one change at a time
- Ask about your graph rather than asking it to design one
- Switch to OpenRouter or Anthropic for anything multi-step

**On a hosted model:**
- Provide more context in your question
- Use screenshots to show visual issues
- Report persistent issues on [GitHub](https://github.com/joby-aviation/noodles.gl/issues)

### API key isn't working

**Problem:** The provider rejects the key.

**Solutions:**
- Check the key is complete — an Anthropic key starts `sk-ant-`, an OpenRouter key `sk-or-`
- Check the account has credit. A free OpenRouter tier also has a daily request cap of roughly 50; past that, requests fail until the next day or you add credit
- For a custom endpoint, press **Test and Save** — it will say whether the address, the key, or the model name is the problem
- Try removing and re-entering the key

## Privacy & Security

### On-device models (local model, Chrome built-in)

- All computation happens in your browser; no prompt is sent anywhere
- Model files are stored in your browser (IndexedDB), and clearing browser data deletes them
- Conversation history is stored only in your browser's localStorage

### Hosted providers (Anthropic, OpenRouter, custom endpoint)

- Your messages, and whatever graph context the assistant reads to answer them, are sent to that provider
- Each provider's own policy applies — Anthropic's is [here](https://www.anthropic.com/legal/privacy)
- Conversation history is still stored locally in your browser
- Keys are stored in your browser's localStorage and are never sent to Noodles.gl

### Recommendations

- Use a **local model** or Chrome's built-in one for sensitive or private data
- Use a **hosted provider** for public projects where quality and speed matter
- Don't store API keys in git repositories or share them publicly
- Clear conversation history regularly if working with sensitive data (delete conversations in history panel)

## Advanced Features

### A model on your own machine

If you run LM Studio, llama.cpp or Ollama locally, point the editor at it: Settings → AI Provider → Custom Endpoint, base URL `http://localhost:1234/v1` (whatever your server uses), model name as the server reports it, and no API key. **Test and Save** will confirm the server is reachable and serves that model.

This is a different thing from the built-in local model: your server, your choice of weights, and no download inside the browser.

### Conversation History

Access past conversations by clicking the history button (📚) in the chat panel header.

- View up to 50 recent conversations
- Click to resume a conversation
- Delete individual conversations
- Clear all history

Conversations are automatically saved as you chat.

## Keyboard Shortcuts

- `Cmd/Ctrl + K` - Open/close chat panel
- `Enter` - Send message
- `Shift + Enter` - New line in message
- `Escape` - Close chat panel or settings modal

## Need More Help?

- **Documentation:** Browse the [user guides](/users/getting-started)
- **Examples:** Check the example projects in the public/noodles folder
- **GitHub Issues:** Report bugs or request features at [github.com/joby-aviation/noodles.gl/issues](https://github.com/joby-aviation/noodles.gl/issues)
- **Discussions:** Ask questions in [GitHub Discussions](https://github.com/joby-aviation/noodles.gl/discussions)

---

**Next Steps:**
- [Learn about operators →](/users/operators-guide)
- [Explore workflows →](/users/workflows-intro)
- [Read developer documentation →](/developers/overview)
