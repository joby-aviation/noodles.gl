---
name: noodles-live
description: Drive a running Noodles.gl editor over WebMCP. Read the document, change data, styling, camera, or timing, check the result with a screenshot, and export the timeline to MP4. Use when Noodles WebMCP tools (get_current_project, apply_modifications, export_video) are available, a Noodles dev server is running on localhost:5173, ?externalControl=true is mentioned, or the user asks to change or re-export what is on screen in Noodles.
---

# Noodles live

Change a project that is open in the browser, check each change, and export it.

## When you are done

You are done when you have shown the user one of these:

- a screenshot of the changed visualization, or
- an exported MP4, with its file name and path.

If the user asked for a video, only the file counts. Once the screenshot or file matches the ask, stop. Don't keep reading code or docs. If you can't get either one, stop and report the step that failed and its exact error.

## 1. Connect

1. Look for the WebMCP tools: `get_current_project`, `apply_modifications`, `export_video`. If they are there, go to step 4.
2. Start the editor (`cd noodles-editor && npm start`) and open `http://localhost:5173/examples/<name>?externalControl=true` in Chrome or Edge. Use one tab. With several, tool names get a tab suffix.
3. Register the relay once, then restart the agent session so the tools load:

   ```bash
   claude mcp add webmcp -- npx -y @mcp-b/webmcp-local-relay@4
   ```

4. Call `get_current_project`. "No project loaded" means the tab is not on a project.

The relay only works on localhost. `run_code` is missing when the URL has `?safeMode=true`.

Without the WebMCP tools you can still look things up: in this repo the `noodles` MCP server has `get_operator_schema`, `list_operators`, `get_documentation` and `get_example` with no browser. It can't see or change the open project.

## 2. Read before you edit

A project is a document: nodes with an `op` (operator type), a `name` and `params`, joined by wires from a `sourcePort` to a `targetPort`. Tools take a node's id, name or path.

1. `list_nodes` for the nodes, their operators, parameters and errors, and the wires.
2. `get_node_info` on the node you will change: every parameter with its kind, default and current value, its ports and wires, and which parameters are keyframed.
3. `get_operator_schema` with the operator type (`scatter`, `attribute`, `file`) before you add a node or a wire. Use the parameter and port names it returns. Never guess one.
4. `get_node_output` to see a node's columns and a sample of its rows before you write an expression that reads them.

A parameter wired from another node's output (`par:<name>`) takes that value. Change the node it comes from instead.

Write down the old value of anything you change, so you can put it back.

## 3. Make one small edit

Send one change per `apply_modifications` call. Parameters merge, so send only the ones that change; `null` puts one back to its default.

```json
{ "modifications": [
  { "type": "update_node", "id": "scatterplot-layer", "params": { "radiusScale": 20 } }
] }
```

- Per-row values are expressions over the rows' columns: a layer's `color` can be `"[255, 0, 0]"` or a column an `attribute` node made. Colors are `[r, g, b]` from 0 to 255.
- A parameter can be `{ "expr": "4 + 2 * sin(T)" }` (`T` is seconds) or `{ "ref": "other-node/param" }`.
- Wires: `{ "type": "add_edge", "source": "data", "sourcePort": "out", "target": "points", "targetPort": "in" }`. A `targetPort` of `par:<name>` drives a parameter from a number output.
- Data: point a `file` node's `url` at another file. Use `list_files` to see what the project has. To use derived data, write it with `write_file` to `@/.agent/<name>.csv` and point the `file` node there. Source data is read-only.
- Camera: the `deck` node's `longitude`, `latitude`, `zoom`, `pitch` and `bearing`, unless the timeline animates them (see step 5).

## 4. Check every edit

1. Note the time before the edit, then call `get_console_errors` with `since` set to it and `level: "error"`. Call `analyze_project` for nodes that failed. Fix any error before the next edit.
2. Call `capture_visualization` and look at the image. Does it show what the user asked for?
3. If not, check in this order: errors on the node (`get_node_info`), its wires, `get_node_output` upstream. Put the old value back if the edit made it worse.

If `capture_visualization` returns "Canvas not available", the map pane may be hidden (make the window wider) or the tool may not find the map canvas. Take the screenshot with your browser tool if you have one. Otherwise export a short clip (step 6) and report that.

## 5. Change timing and animation

1. `get_timeline` returns the length, frame rate, playback position, and each keyframed parameter with its keyframes.
2. A track's target is `node.param` with the node's id: `deck.bearing`, `points.opacity`. A table cell is `node.rows.<row>.<column>`.
3. `set_keyframe` takes `target`, `time` in seconds, `value`, and optionally `interpolation` (`bezier`, `linear` or `hold`). A keyframe already at that time is updated. `delete_keyframe` takes its id or its time.
4. Keep times inside the timeline's length. To change the length, ask the user to change it in the timeline panel.
5. A keyframed parameter takes its value from the track, so edit its keyframes, not the parameter.
6. Check frames: `set_playback_position` to the start, middle, and end, and `capture_visualization` at each.

## 6. Export

1. Call `export_video`. Every argument is optional (`startTime`, `endTime`, `fps`, `width`, `height`, `codec`, `download`). Missing ones come from the `deck` node's render settings and the timeline. For a quick check, use `width: 640, height: 360`.
2. The call returns after at most 20 s. While `status` is `running`, call `get_export_status` until it is `done`.
3. Don't edit or scrub while it renders. The export moves the playhead and takes over the canvas.
4. Report the file name, where `savedTo` says it went, size, frame count, and duration. `savedTo.project` is a path like `@/.agent/renders/<project>-<timestamp>.mp4`; confirm it with `list_files` and `path: ".agent/renders"`. If only `savedTo.download` is set, the project could not be written and the file is in the browser's downloads folder.

Example projects live in memory, so their saved copy is gone after a reload. Pass `download: true` there to also save it to the browser's downloads folder. Export needs WebCodecs, so use Chrome or Edge. A hidden or background tab renders much slower.

## Saving

Live edits change the open project. They do not write `noodles.json` in the repo. If the user wants the change in a file, tell them to save from the editor, or edit the file as described in `dev-docs/claude-code-workflow.md`.

If you edit the file yourself, validate it before you report it done: `validate_project` with its path (the `noodles` MCP server), or `npm run validate:projects -- <path>` from the repo root (not `npx validate-projects`, which can download a package from npm). Fix every error it lists. The file is done when it validates.
