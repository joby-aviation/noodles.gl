---
name: noodles-live
description: Drive a running Noodles.gl editor over WebMCP. Read the graph, change data, styling, camera, or timing, check the result with a screenshot, and export the timeline to MP4. Use when Noodles WebMCP tools (get_current_project, apply_modifications, export_video) are available, a Noodles dev server is running on localhost:5173, ?externalControl=true is mentioned, or the user asks to change or re-export what is on screen in Noodles.
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

## 2. Read before you edit

1. `list_nodes` for the node ids, types, and current inputs.
2. `get_node_info` on the node you will change. It shows its edges and input schema.
3. `get_operator_schema` with the operator type before you add a node or edge. Use the field names it returns. Never guess a handle name.
4. `get_node_output` (or `run_code`) to see the data shape before you change an accessor or a CodeOp.

If the input you want to change has an incoming edge, the edge wins. Change the upstream node it comes from instead.

Write down the old value of anything you change, so you can put it back.

## 3. Make one small edit

Send one change per `apply_modifications` call. Inputs merge, so send only the inputs that change.

```json
{ "modifications": [
  { "type": "update_node", "data": { "id": "/scatterplot-layer", "data": { "inputs": { "getRadius": 20 } } } }
] }
```

- Edges: `{ "type": "add_edge", "data": { "id": "/a.out.data->/b.par.data", "source": "/a", "target": "/b", "sourceHandle": "out.data", "targetHandle": "par.data" } }`. Handles are `out.<field>` and `par.<field>`.
- Data: point a FileOp's `url` at another file. Use `list_files` to see what the project has. To use derived data, write it with `write_file` to `@/.agent/<name>.csv` and point the FileOp there. Source data is read-only.
- Camera: update the `viewState` input (`longitude`, `latitude`, `zoom`, `pitch`, `bearing`) on the MaplibreBasemapOp, unless the timeline animates it (see step 5).

## 4. Check every edit

1. Note the time before the edit, then call `get_console_errors` with `since` set to it and `level: "error"`. Fix any error before the next edit.
2. Call `capture_visualization` and look at the image. Does it show what the user asked for?
3. If not, check in this order: console errors, edges on the node, `get_node_output` upstream. Put the old value back if the edit made it worse.

If `capture_visualization` returns "Canvas not available", the map pane may be hidden (make the window wider) or the tool may not find the map canvas. Take the screenshot with your browser tool if you have one. Otherwise export a short clip (step 6) and report that.

## 5. Change timing and animation

1. `get_timeline` returns the sequence length and fps, and every animatable track. Only tracks with keyframes are animated.
2. Track ids are `<node id without the slash> / <field>`, with nested fields joined the same way: `time / val`, `maplibre-basemap / viewState / zoom`.
3. `set_keyframe` takes `trackId`, `position` in seconds, and `value`. A keyframe within one frame of `position` is updated in place. `delete_keyframe` takes the id from `get_timeline`.
4. Keep positions inside the sequence length. `set_keyframe` accepts a later position but does not make the timeline longer. To change the length, ask the user to change it in the timeline panel.
5. A camera track overrides the `viewState` input for that field. Edit its keyframes, not the input.
6. Check frames: `set_playback_position` to the start, middle, and end, and `capture_visualization` at each.

## 6. Export

1. Call `export_video`. Every argument is optional (`startTime`, `endTime`, `fps`, `width`, `height`, `codec`, `download`). Missing ones come from the project's render settings and the timeline in and out points. For a quick check, use `width: 640, height: 360`.
2. The call returns after at most 20 s. While `status` is `running`, call `get_export_status` until it is `done`.
3. Don't edit or scrub while it renders. The export moves the playhead and takes over the canvas.
4. Report the file name, its path (`@/.agent/renders/<project>-<timestamp>.mp4`), size, frame count, and duration. `list_files` with `path: ".agent/renders"` confirms it.

Example projects live in memory, so their saved copy is gone after a reload. Pass `download: true` there to also save it to the browser's downloads folder. Export needs WebCodecs, so use Chrome or Edge. A hidden or background tab renders much slower.

## Saving

Live edits change the open project. They do not write `noodles.json` in the repo. If the user wants the change in a file, tell them to save from the editor, or edit the file as described in `dev-docs/claude-code-workflow.md`.
