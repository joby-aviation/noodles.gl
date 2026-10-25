---
title: Use Noodles with your AI agent
description: The ways an AI agent can build, change and export Noodles.gl visualizations, from the in-app chat to Claude Code, Codex, Gemini CLI and Cursor.
---

import Tabs from '@theme/Tabs'
import TabItem from '@theme/TabItem'

# Use Noodles with your AI agent

There are four ways to work on Noodles.gl with an AI agent. Pick by where the agent runs and what you want it to change.

| Way | What the agent can do | What you need |
| --- | --- | --- |
| [In-app assistant](#the-in-app-assistant) | Answer questions and propose graph edits for you to accept | A browser. Nothing to install |
| [Drive a running editor](#drive-a-running-editor) | Change the map on screen, check it with a screenshot, set keyframes, export an MP4 | A coding agent, a local checkout, Chrome or Edge |
| [Write project files](#write-project-files) | Create or edit `noodles.json` files and check them, with no browser | A coding agent and a local checkout |
| [Read the docs](#point-an-agent-at-the-docs) | Look things up while it works on your own code | Any agent that can fetch a URL |

The fastest way to try the second one is the quick start prompt on the [home page](/#ai-agents): paste it into your agent and it installs Noodles.gl, opens an example map, changes it, and shows you a screenshot.

## The in-app assistant

The chat panel inside the editor (`Cmd+K` / `Ctrl+K`) is its own agent. It reads your graph, runs code against it, searches the docs, and proposes changes. Each proposed batch of changes shows up as a card listing every change, and nothing touches the graph until you click **Accept**. An accepted batch is one undo step.

It runs on a free OpenRouter connection, a model on your own GPU, or your own API key. See [AI Assistant](./ai-assistant.md) for setup.

Use it when you are already in the editor and want help with the project in front of you. Use a coding agent when you want to work from your terminal or IDE, change files in a repo, or export video without clicking.

## Drive a running editor

When you open the editor with `?externalControl=true`, it offers its tools over [WebMCP](https://github.com/webmachinelearning/webmcp). A small relay, `@mcp-b/webmcp-local-relay`, passes them to your agent as an MCP server. The agent then works on the open project the same way the in-app assistant does, and the changes appear in the browser as it makes them.

### Set it up

1. Clone the repo and install:

   ```bash
   git clone --depth 1 https://github.com/joby-aviation/noodles.gl.git
   ```

   ```bash
   cd noodles.gl && npm install
   ```

2. Register the relay with your agent, once:

   <Tabs groupId="mcp-client">
   <TabItem value="claude-code" label="Claude Code" default>

   ```bash
   claude mcp add webmcp -- npx -y @mcp-b/webmcp-local-relay@4
   ```

   </TabItem>
   <TabItem value="codex" label="Codex">

   ```bash
   codex mcp add webmcp -- npx -y @mcp-b/webmcp-local-relay@4
   ```

   </TabItem>
   <TabItem value="gemini" label="Gemini CLI">

   Run in the repo folder. It writes `.gemini/settings.json` there; add `-s user` to register it for every folder.

   ```bash
   gemini mcp add webmcp npx -y @mcp-b/webmcp-local-relay@4
   ```

   </TabItem>
   <TabItem value="cursor" label="Cursor">

   Add to `.cursor/mcp.json` in the repo folder:

   ```json
   {
     "mcpServers": {
       "webmcp": {
         "command": "npx",
         "args": ["-y", "@mcp-b/webmcp-local-relay@4"]
       }
     }
   }
   ```

   </TabItem>
   <TabItem value="vscode" label="VS Code">

   Add to `.vscode/mcp.json` in the repo folder:

   ```json
   {
     "servers": {
       "webmcp": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "@mcp-b/webmcp-local-relay@4"]
       }
     }
   }
   ```

   </TabItem>
   <TabItem value="other" label="Other">

   Any MCP client that runs stdio servers works. The command is `npx` with the arguments `-y @mcp-b/webmcp-local-relay@4`.

   </TabItem>
   </Tabs>

3. Start your agent in the repo folder. Most agents load MCP servers only when they start, so restart it if it was already running.
4. Start the editor:

   ```bash
   cd noodles-editor && npm start
   ```

5. Open a project with external control on, in Chrome or Edge. An example opens at `http://localhost:5173/examples/<name>?externalControl=true`, such as `examples/nyc-taxis`. Your own projects live at `http://localhost:5173/projects/<name>?externalControl=true`, where `<name>` is the project folder's name, once you have opened the folder in the editor.

Do these in order. The relay starts with your agent, and the page looks for it for about 10 seconds after it loads. A tab opened before the agent started won't connect until you reload it.

### Ask for changes

Ask in plain words: "make the arcs red", "zoom to Manhattan and tilt the camera", "fade the points in over the first 2 seconds", "export a 5 second video". The agent can:

- read the graph and each node's inputs, outputs and current data
- add, change and remove nodes and connections
- run JavaScript against the live graph to inspect data
- read and write the project's data files (it writes only under `@/.agent/`)
- capture a screenshot of the map to check its work
- read and set timeline keyframes
- render the timeline to an MP4 with `export_video`

The repo includes a skill, [`noodles-live`](https://github.com/joby-aviation/noodles.gl/blob/main/.claude/skills/noodles-live/SKILL.md), that walks an agent through this loop: read before editing, make one change, check the screenshot, export. Claude Code loads it on its own in the repo. For other agents, ask them to read `.claude/skills/noodles-live/SKILL.md` first.

### Export video

`export_video` renders the timeline the same way the Export button does. Every setting is optional (start and end time, frame rate, size, codec); the rest come from the project's render settings. The file goes to `@/.agent/renders/` in the project, and to your downloads folder if you ask for it. Long renders keep going after the agent's call returns, and the agent checks on them with `get_export_status`.

Exporting needs WebCodecs, so use Chrome or Edge. Example projects live in memory, so ask for a download there if you want to keep the file after a reload.

### Things to know

- **Changes go straight to the open project.** Unlike the in-app assistant, a connected agent doesn't wait for you to accept each change. Save before you ask for a large one.
- **Live edits don't write files.** Save from the editor to keep them, or have the agent edit `noodles.json` as described below.
- **Keep the tab visible.** A hidden tab stops drawing, so screenshots fail until you bring the browser back to the front.
- **Use one tab.** With several Noodles tabs open, the relay adds a tab id to each tool name.
- **Local only.** The relay connects to editors on `localhost`. `?safeMode=true` removes the tool that runs code.

## Write project files

A project is a `noodles.json` file: a list of nodes, the edges between them, and the timeline. A coding agent can write one directly. Two tools in the repo keep it from guessing.

**The `noodles` MCP server** answers from your checkout, with no editor running:

- `list_operators` and `get_operator_schema`: every operator, and one operator's inputs, outputs and the exact names to wire them with
- `get_documentation`: search these docs, or read a page by id
- `list_examples` and `get_example`: the example projects, with their READMEs and data files
- `validate_project`: the check below, as a tool

**The validator** checks a file against the operator registry: schema version, operator types, input names, connections, duplicates and loops. Each error names the fix. From the repo root:

```bash
npm run validate:projects -- path/to/noodles.json
```

The file is done when it prints `OK`.

For editor autocompletion, the file shape is also published as a JSON Schema at [noodles.gl/schema/noodles-project.schema.json](https://noodles.gl/schema/noodles-project.schema.json). Map `noodles.json` files to it in your code editor (in VS Code, the `json.schemas` setting), or to `noodles-document.v<N>.schema.json` to pin a version. Projects saved before documents match `noodles-project.v20.schema.json`. The schema checks shape only, so still run the validator.

### Register the `noodles` server

Claude Code sessions in the repo pick it up from `.mcp.json` after `npm install`; approve it when asked. For other agents, or a session outside the repo, register it with the full path to your checkout:

<Tabs groupId="mcp-client">
<TabItem value="claude-code" label="Claude Code" default>

```bash
claude mcp add noodles -- node /path/to/noodles.gl/noodles-mcp/bin/noodles-mcp.ts
```

</TabItem>
<TabItem value="codex" label="Codex">

```bash
codex mcp add noodles -- node /path/to/noodles.gl/noodles-mcp/bin/noodles-mcp.ts
```

</TabItem>
<TabItem value="gemini" label="Gemini CLI">

```bash
gemini mcp add noodles node /path/to/noodles.gl/noodles-mcp/bin/noodles-mcp.ts
```

</TabItem>
<TabItem value="cursor" label="Cursor">

In `.cursor/mcp.json`, next to `webmcp`:

```json
{
  "mcpServers": {
    "noodles": {
      "command": "node",
      "args": ["/path/to/noodles.gl/noodles-mcp/bin/noodles-mcp.ts"]
    }
  }
}
```

</TabItem>
<TabItem value="vscode" label="VS Code">

In `.vscode/mcp.json`, next to `webmcp`:

```json
{
  "servers": {
    "noodles": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/noodles.gl/noodles-mcp/bin/noodles-mcp.ts"]
    }
  }
}
```

</TabItem>
<TabItem value="other" label="Other">

A stdio server: the command is `node`, with the path to `noodles-mcp/bin/noodles-mcp.ts` in your checkout as its argument. It needs Node 22.18 or later.

</TabItem>
</Tabs>

Don't run either tool through a bare `npx noodles-mcp` or `npx validate-projects`. Neither name is published on npm, so `npx` would download whatever someone else publishes under it.

### How an agent should write a file

1. Find a similar example with `list_examples` and read it with `get_example`.
2. Read each operator it will use with `get_operator_schema` before connecting it.
3. Write the file, validate it, and fix every error.
4. Stop when it validates.

To look at the result, open the project folder (the one holding `noodles.json` and its data files) with **Open** (`Cmd+O` / `Ctrl+O`) in the editor menu, in Chrome or Edge. This works in a local editor or at [noodles.gl/app](https://noodles.gl/app). The editor then shows the project at `/projects/<name>`, where `<name>` is the folder's name (for example `noodles.gl/app/projects/<name>`), and that URL opens it again later.

`/examples/<name>` is only for the bundled examples. In a local checkout, a project written to `noodles-editor/src/examples/<name>/noodles.json` shows up there too.

Small graphs work best: five to eight nodes that a person can read. One `CodeOp` with a few lines of JavaScript is easier to check than a chain of filter, map and sort nodes. The validator doesn't check the timeline, so set keyframes in the editor or through a running editor (above) rather than by hand.

The repo's [`AGENTS.md`](https://github.com/joby-aviation/noodles.gl/blob/main/AGENTS.md) describes the file format and code layout for agents. Codex, Cursor, Claude Code (through `CLAUDE.md`) and other agents that read `AGENTS.md` load it on their own.

## Point an agent at the docs

For an agent working on your own code, such as an app that embeds a Noodles visualization, point it at [noodles.gl/llms.txt](/llms.txt). It lists these docs, the quick start prompts, and the agent setup pages in a form agents read well.

## Which way to use

- **Trying Noodles for the first time:** the in-app assistant, or the quick start prompt if you already use a coding agent.
- **Changing a map and exporting video:** drive a running editor.
- **Generating many projects, or keeping them in git:** write project files and validate them.
- **Both:** connect both servers. The agent writes the file with the `noodles` server, you open it, and the agent fine-tunes it live. With both connected, tools with the same name are told apart by server, such as `noodles` and `webmcp` versions of `get_operator_schema`.
