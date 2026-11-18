# WebMCP local relay embed

`embed.js`, `widget.html` and `widget.js` are `dist/browser/` from
[`@mcp-b/webmcp-local-relay`](https://www.npmjs.com/package/@mcp-b/webmcp-local-relay) 4.0.0
(MIT, see `LICENSE`), copied unchanged. The editor serves them itself instead of loading them
from a CDN, so the version is pinned (the embed resolves `widget.html` next to its own URL)
and the relay works offline.

To update: `npm pack @mcp-b/webmcp-local-relay@<version>`, copy the three files from
`package/dist/browser/`, and keep the relay major the same as the one `docs/users/ai-agents.md`
tells users to run.
