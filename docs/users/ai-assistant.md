# AI Assistant

The assistant is a chat panel inside the editor. It reads your project, answers questions about operators, changes the graph for you to review, and can check its work with a screenshot. Open it with the **Assistant** button at the right end of the top bar.

To work from a coding agent in your terminal or IDE instead, see [Use Noodles with your AI agent](./ai-agents.md).

## Connect a provider

The first time you open the panel, it asks which model to use. The quickest choice is **Connect OpenRouter**: a sign-in window opens, you approve, and the editor receives its own OpenRouter key. There is nothing to copy or paste. OpenRouter's free tier allows about 50 messages a day, and the model picker lists free models that support tool calling first. The assistant needs tool calling to read and change your graph.

| Provider | Cost | Notes |
| --- | --- | --- |
| OpenRouter | Free tier, or paid models with credit | Connect in one click, or paste a key |
| Anthropic | Your API key (`sk-ant-…`) | Claude Sonnet 5, Opus 5 and Haiku 4.5. The best answers |
| Custom endpoint | Depends on the service | Any OpenAI-compatible API, including a server on your own machine |
| Local model | Free, a one-time download of 0.9 to 4.7 GB | Runs on your GPU. Nothing leaves the browser |
| Chrome built-in AI | Free | Experimental. Chrome 127 or later |
| ACP agent | Your agent's own plan or key | Claude Code, Codex, Gemini CLI and others, running on your machine |

Every provider is set up in Settings → **AI Provider** (the ⚙️ beside the model picker in the panel). Anthropic and OpenRouter keys can also be pasted in Settings → **API Keys**.

### Choosing a provider and model

The two dropdowns at the top of the panel pick the provider and the model. Picking a provider you haven't set up opens its settings instead.

In Settings → AI Provider, **Automatic (recommended)** uses the first provider that is ready, in this order: Anthropic, OpenRouter, custom endpoint, local model. The local model only counts once you have chosen one, so nothing large downloads unless you ask for it. Chrome built-in AI and ACP agents are never picked automatically. If a provider you picked stops working because its key was removed, the panel falls back to the same order.

### Local model

Settings → AI Provider → **Local model (on-device)**, then choose a model. Nothing downloads until you do. Each entry shows its download size and the GPU memory it needs:

- **Qwen3.5 4B** (2.4 GB download, 3.9 GB GPU memory): the default, with the better answers
- **Qwen3.5 2B** (1.1 GB download, 2.2 GB GPU memory): faster and needs about half the memory. The panel offers it if the 4B fails to load

Older models are under **Advanced compatibility**. The download happens once with a progress bar; after that the model is cached in the browser.

This needs WebGPU (Chrome and Edge have it). Without it, the option is disabled. Expect 10 seconds to a minute per answer. A local model has a 4,096-token window, so it is good for questions about your graph and single edits, not for building a visualization from a sentence.

### Custom endpoint

Settings → AI Provider → **Custom Endpoint Configuration** takes a base URL, an optional key, a model name and a display name. The presets fill these in for Groq, Google AI Studio, Cerebras and OpenAI, and link to the page that issues a key. Groq, Google AI Studio and Cerebras give free keys without a card.

A server on your own machine (LM Studio, llama.cpp, Ollama) needs no key: enter its address, such as `http://localhost:1234/v1`, and the model name it reports. **Test and Save** checks that the server answers and serves that model before saving, so a typo shows up there instead of mid-conversation. After a successful test, the model field suggests the models the endpoint listed.

### ACP agent

Any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com/) can run the chat: Claude Code, Codex, Gemini CLI, Goose, OpenCode and others. The agent runs on your computer with its own login and model, and gets the editor's tools so it can read and change your graph.

A browser tab cannot start a program, so a small bridge starts the agent. From a noodles.gl checkout:

```bash
node noodles-mcp/bin/noodles-mcp.ts acp -- npx -y @agentclientprotocol/claude-agent-acp
```

Use `@agentclientprotocol/codex-acp` for Codex, or the ACP command your agent's documentation gives. The bridge prints a `ws://127.0.0.1:7341/acp?token=…` URL. Paste it into Settings → AI Provider → **ACP agent** and press **Save**, then pick the agent in the panel.

- Sign in to the agent once in a terminal first (for Claude Code, run `claude` and log in).
- The agent works in the folder you started the bridge in (or `--cwd <dir>`) and can read and change files there. It asks before it runs a command, and the chat shows its question with the options it offers.
- The model dropdown lists the models the agent offers.
- The token in the URL changes each time the bridge starts. To keep one URL, pass `--token <something long>` or set `NOODLES_ACP_TOKEN`.
- Only noodles.gl and a local dev server on port 5173 may connect. Add another address with `--allow-origin https://your.host`. `--help` lists every option.

## Using the assistant

Type a question and press Enter (Shift+Enter for a new line). Some things to ask:

- "What does the heatmap layer do?" or "How do I load a CSV file?"
- "Show these stations as points colored by line"
- "Nothing is showing up on the map, can you help?"
- "Find an example that animates paths"

To answer, the assistant can read your graph and each node's output, change nodes and connections, run JavaScript against your project to compute something, read the project's data files and write new ones under `@/.agent/` (which a `file` node can then load), set timeline keyframes, search these docs, the example projects and the source code, and look up an operator's inputs. With an Anthropic or OpenRouter key it can also search the web. OpenRouter bills web searches even on free models.

### Reviewing changes

The assistant makes its changes as it works, so it can see the results and fix errors. When it finishes, the panel shows a **Review graph update** card listing every node, value and connection it added, changed or removed, and the map already shows them. **Accept** keeps the changes as one undo step. **Reject** undoes them and tells the assistant, so you can ask for something different.

You can't send another message while a card is waiting. Starting a new conversation or loading an old one undoes the waiting changes; opening another project drops them.

### Screenshots

When the current model accepts images, a **📸 Capture** button appears in the panel. It attaches a screenshot of the map to your next message, which helps when something looks wrong. The assistant can also take its own screenshots to check a change.

### Conversation history

The 📋 button in the panel header lists your last 50 conversations. Click one to resume it, or delete one or all of them. ➕ starts a new conversation. Conversations are saved in your browser when you start a new one, load another, or close the panel.

## Tips

- **Be specific.** "Show NYC subway stations as points colored by line" works better than "make a map".
- **Go step by step** on larger tasks: load the data, filter it, then style it.
- **Match the model to the task.** A local or Chrome model is fine for questions and single edits. For anything multi-step, switch to OpenRouter or Anthropic rather than rephrasing.

## Troubleshooting

**The local model option is disabled.** Your browser doesn't offer WebGPU. Use Chrome or Edge, or click **Connect OpenRouter**.

**The model download failed.** Check your connection and choose the model again in Settings → AI Provider. If it keeps failing, try a smaller model or use OpenRouter.

**Answers are slow or the browser runs out of memory.** Close other tabs that use the GPU, start a new conversation (a long transcript is slower on a small model), or pick Qwen3.5 2B, which needs about half the memory of the 4B. Hosted providers don't use your GPU at all.

**A key isn't working.** Check that it is complete: Anthropic keys start with `sk-ant-` and OpenRouter keys with `sk-or-`. Check that the account has credit; on OpenRouter's free tier, requests fail once the daily cap is reached. For a custom endpoint, **Test and Save** says whether the address, the key or the model name is the problem.

**Answers are wrong or vague.** On a local or Chrome model, ask for one change at a time. On a hosted model, give more detail or attach a screenshot. Report persistent problems on [GitHub](https://github.com/joby-aviation/noodles.gl/issues).

## Privacy

- **Local model and Chrome built-in AI:** everything runs in your browser and no prompt is sent anywhere. Model files are stored in the browser, and clearing site data deletes them.
- **Anthropic, OpenRouter and custom endpoints:** your messages go to that provider, along with whatever the assistant reads to answer them: node settings, rows of your data, file contents and screenshots. The provider's own privacy policy applies.
- **ACP agent:** the agent on your machine sees the same things and sends them to whatever model service it uses.
- **Keys** are stored in your browser's local storage and are never sent to Noodles.gl. AI keys are never saved in a project file, and an AI key inside a project file someone else made is ignored. See [API Keys Configuration](./api-keys.md).
- **Conversation history** stays in your browser's local storage. Delete conversations from the history panel when you work with sensitive data.

For sensitive data, use a local model.

## More help

- [Use Noodles with Claude Code, Codex, Gemini CLI or Cursor](./ai-agents.md)
- [Operators guide](/users/operators-guide)
- [Workflows](/users/workflows-intro)
- [GitHub Discussions](https://github.com/joby-aviation/noodles.gl/discussions)
