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

### First-Time Setup

When you open the chat for the first time, you'll see a welcome message explaining the two ways to use the AI:

1. **Local (in your browser)** - Free, private, works offline
2. **Remote (Anthropic API)** - Faster, higher quality, requires API key

The assistant will automatically select **local mode** and begin downloading the AI model to your computer. This is a one-time download that takes 3-4 minutes on a typical internet connection.

### Model Download

While the model downloads, you'll see a progress bar showing:
- Download percentage
- Data transferred (e.g., 1.2 GB / 2.3 GB)
- Estimated time remaining

Once complete, the model is stored in your browser and loads instantly on future visits.

## Local vs Remote Models

### Local Model (WebLLM)

**How it works:** The AI runs entirely in your browser using WebGPU technology. After the initial download, no internet connection is required.

**Pros:**
- ✅ **Free** - No API costs
- ✅ **Private** - Your data never leaves your device
- ✅ **Offline** - Works without internet (after initial download)
- ✅ **No API key needed**

**Cons:**
- ❌ **Slower** - Responses take 3-5 seconds vs sub-second for remote
- ❌ **Large download** - Requires ~2.3 GB disk space
- ❌ **Requires powerful device** - Needs modern laptop/desktop with WebGPU support
- ❌ **Lower quality** - May struggle with very complex tasks

**Requirements:**
- Modern browser with WebGPU support:
  - Chrome 113+ or Edge 113+
  - Safari 17+ (macOS Sonoma or later)
  - Firefox (WebGPU coming soon)
- At least 4 GB of available RAM
- ~3 GB of disk space for the model

**Recommended for:**
- Users who want privacy and don't mind waiting a few seconds
- Working offline or with limited internet
- Students and learners who want to explore without API costs
- Projects with sensitive data

### Remote Model (Anthropic API)

**How it works:** The AI runs on Anthropic's servers using their Claude Sonnet model. Your messages are sent over the internet and responses stream back.

**Pros:**
- ✅ **Fast** - Sub-second responses
- ✅ **High quality** - State-of-the-art AI model
- ✅ **No download** - Works immediately
- ✅ **Works on any device** - No special hardware requirements

**Cons:**
- ❌ **Costs money** - You pay per message (typically $0.01-0.05 per conversation)
- ❌ **Requires API key** - Must sign up for Anthropic account
- ❌ **Internet required** - Doesn't work offline
- ❌ **Less private** - Data is sent to Anthropic (see their [privacy policy](https://www.anthropic.com/legal/privacy))

**Requirements:**
- Anthropic API key ([get one here](https://console.anthropic.com/))
- Internet connection

**Recommended for:**
- Users who need fast, high-quality responses
- Complex projects with many steps
- Professional work where time is valuable
- Devices that don't support WebGPU

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

Click the gear icon (⚙️) in the chat panel header to open settings.

### Switching Between Local and Remote

You can switch between local and remote models at any time:

1. Open Settings
2. Select **Local (WebLLM)** or **Remote (Anthropic)**
3. If switching to Remote, enter your API key
4. Click **Save Changes**

Your conversation history is preserved when switching.

### Model Selection

**Local Model:** Choose which model to use:
- **Phi-3 Mini (Recommended)** - Best balance of speed and quality (~2.3 GB)
- **Custom model URL** - Advanced users can specify their own WebLLM-compatible model

**Remote API:** Enter your Anthropic API key:
- Get an API key from [console.anthropic.com](https://console.anthropic.com/)
- Check "Remember key" to save it across sessions (stored in your browser)
- Click "Get API key" for help signing up

### Conversation Settings

**History length:** How many messages to remember (default: 7 messages)
- **Shorter (3-5)** - Faster, uses less memory, but AI forgets context quickly
- **Longer (10-20)** - Better context retention, but slower and uses more memory
- Tip: Use shorter history for quick questions, longer for complex multi-step tasks

**Auto-capture screenshots:** Automatically capture visualization screenshots with each message
- Helpful for visual debugging
- Increases response time and message size
- Can be triggered manually with the camera button

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

### Switch to Remote for Complex Tasks

If the local model is struggling with a complex task (taking too long, giving unclear answers), try switching to the remote API for better results.

## Troubleshooting

### "WebGPU not supported"

**Problem:** Your browser doesn't support WebGPU, which is required for the local model.

**Solutions:**
- Update your browser to the latest version (Chrome 113+, Edge 113+, Safari 17+)
- Use the remote API instead (requires API key)
- Use a different device with a modern browser

### "Model download failed"

**Problem:** The model download was interrupted or failed.

**Solutions:**
- Check your internet connection
- Click "Retry Download"
- Clear your browser cache and try again
- If problems persist, use the remote API

### Responses are very slow

**Problem:** The local model is taking 10+ seconds to respond.

**Causes:**
- Your device may not have enough GPU power
- Other tabs or applications are using GPU resources
- Too much conversation history (try reducing history length in settings)

**Solutions:**
- Close other tabs and applications
- Reduce history length in settings (Settings → History length → 3-5 messages)
- Switch to remote API for faster responses
- Restart your browser

### "Out of memory" error

**Problem:** The browser ran out of memory while running the AI model.

**Solutions:**
- Close other tabs and applications
- Restart your browser
- Reduce history length in settings
- Use the remote API (doesn't use your device's memory)

### AI gives incorrect or unhelpful answers

**Problem:** The response isn't helpful or contains mistakes.

**For local model:**
- Try rephrasing your question more specifically
- Break down complex tasks into smaller steps
- Switch to remote API for better quality
- Check if the model is still downloading (progress bar at top)

**For remote model:**
- Provide more context in your question
- Use screenshots to show visual issues
- Report persistent issues on [GitHub](https://github.com/joby-aviation/noodles.gl/issues)

### API key isn't working

**Problem:** Remote API fails with "Invalid API key" error.

**Solutions:**
- Double-check your API key from [console.anthropic.com](https://console.anthropic.com/)
- Make sure you copied the entire key (starts with `sk-ant-`)
- Check that your Anthropic account has credits
- Try removing and re-entering the key

## Privacy & Security

### Local Model

When using the local model:
- All computation happens in your browser
- No data is sent to any servers
- Conversation history is stored only in your browser's localStorage
- Model files are stored in IndexedDB (browser storage)
- Clearing your browser data will delete the model and conversation history

### Remote API

When using the remote API:
- Your messages are sent to Anthropic's servers for processing
- Conversation history is still stored locally in your browser
- Anthropic may store messages according to their [privacy policy](https://www.anthropic.com/legal/privacy)
- API keys are stored in your browser's localStorage (not sent to Noodles.gl servers)

### Recommendations

- Use **local model** for sensitive or private data
- Use **remote API** for public projects where speed matters
- Don't store API keys in git repositories or share them publicly
- Clear conversation history regularly if working with sensitive data (delete conversations in history panel)

## Advanced Features

### Custom Models

Advanced users can use custom WebLLM-compatible models:

1. Open Settings
2. Select "Custom model URL" under Local Model
3. Enter the model URL (must be WebLLM-compatible)
4. Save and restart chat

**Note:** Custom models must follow the [WebLLM model format](https://github.com/mlc-ai/web-llm). Only use models from trusted sources.

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
