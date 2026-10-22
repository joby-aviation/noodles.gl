---
id: quick-start-screenshot
taskVersion: 1
family: quick-start
tags: [quick-start, live]
# The prompt is the published quick-start prompt, copied verbatim. See Notes:
# this copy is a placeholder until the prompt is published.
promptFile: fixtures/quick-start-prompt.txt
budget:
  maxTurns: 60
  maxWallClockSeconds: 900
tiers:
  T0: none of the repo; the session starts in an empty directory and gets
    only what the prompt tells it to fetch (the public repo at main)
workspace:
  mode: empty
grader:
  rubric: quick-start.yaml
  # the nested live session's transcript, which carries the capture
  artifact: noodles.gl/.quick-start/run.jsonl
  mechanical:
    custom: quick-start-screenshot
    agentScreenshot: true
---

# quick-start-screenshot

Someone with Claude Code pastes the one prompt from the Noodles site into a
fresh session in an empty folder. Done when the session has installed
Noodles, opened an example, changed it, and shown a screenshot.

## Prompt (verbatim)

Read from `promptFile` (`fixtures/quick-start-prompt.txt`) so the task always
runs the exact published text.

## Mechanical checks (Layer 1, frozen at run time)

1. `repo-cloned-and-installed`: a `noodles-editor/` checkout with
   `node_modules/` exists in the workspace.
2. `screenshot-saved` and `agentScreenshotNonBlank`: the session wrote an
   image outside the repo's own image trees; the newest one is copied to
   `agent-screenshot.<ext>` in the run directory and must be non-blank.
3. `answer-gives-screenshot-path`: the final answer names that file.
4. `done-within-5-minutes`: session wall clock ≤ 300 s, the promise the
   quick start makes. The hard budget is 15 minutes so a slow setup still
   finishes and registers as a failed check rather than a missing run.

## Notes

- **Placeholder prompt.** `fixtures/quick-start-prompt.txt` is a snapshot of
  the draft quick-start prompt (2026-10-21) on an unmerged branch. When the
  published prompt lands (`website/static/claude-code-prompt.txt`), copy it
  here verbatim and bump `taskVersion`; a changed prompt is a changed task
  (07 D7).
- **Environment.** The prompt opens a real browser tab (`open -a "Google
  Chrome"` on macOS, `xdg-open` on Linux) and connects to it through the
  WebMCP local relay. A headless container without a desktop browser fails at
  step 5 by design of the prompt, not of the session, so run this task on a
  machine with Chrome, or give the container one. The harness kills processes
  started from the workspace (the dev server) after the session; it cannot
  close the browser tab.
- **Run it on a dedicated machine or VM, not a personal one.** The session
  drives the machine's real default browser. In the first baseline run
  (sonnet-5, 2026-10-21) it left the prompt's steps when the tab did not
  connect: it scripted Chrome through AppleScript, read the Chrome profile's
  extension folders, and clicked Chrome's "Allow JavaScript from Apple Events"
  menu item through System Events. The per-run config dir does not contain
  any of that; only the machine boundary does.
- **Tier.** The session clones public `main`, which includes the
  `noodles-live` skill and the WebMCP tools. Workspace stripping does not
  apply (there is no workspace checkout to strip), so this task measures the
  published experience, not a resource tier. Compare its rows only with
  each other.
- The `claude mcp add` and nested `claude -p` calls inherit the session's
  per-run `CLAUDE_CONFIG_DIR` (every claude session gets one), so the relay
  registration never reaches the operator's config and is deleted after the
  run.
