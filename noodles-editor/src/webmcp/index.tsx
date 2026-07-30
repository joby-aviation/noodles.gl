// WebMCP provider — registers the AI tool surface on navigator.modelContext
// while mounted. Loaded lazily from app.tsx when ?externalControl=true.

import { type FC, useEffect } from 'react'
import { debugWebMCP } from '../utils/debug'
import { initWebMCP } from './register'

// The npx local relay (@mcp-b/webmcp-local-relay) only discovers tabs that load
// its embed script; the WebMCP extension and native Chrome paths need nothing.
// Pinned CDN build, injected on localhost only — same trust model as the
// legacy WebSocket bridge. The pinned version must match the relay major the
// docs tell users to run (the discovery handshake changes between majors).
// To self-host instead, copy embed.js/widget.js/widget.html from the package
// tarball into public/webmcp/.
const RELAY_EMBED_URL =
  'https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4.0.0/dist/browser/embed.js'

function loadRelayEmbed() {
  const isLocalhost =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  if (!isLocalhost) return
  // [data-webmcp-relay] is the embed's own marker for its widget iframe — its
  // presence means the relay bridge is already initialized
  if (document.querySelector('[data-webmcp-relay]')) return
  if (document.querySelector('script[data-noodles-webmcp-relay]')) return

  try {
    const script = document.createElement('script')
    script.src = RELAY_EMBED_URL
    script.async = true
    script.dataset.noodlesWebmcpRelay = 'true'
    script.onerror = () => debugWebMCP('relay embed failed to load')
    document.head.appendChild(script)
  } catch (error) {
    debugWebMCP('relay embed injection failed:', error)
  }
}

export const WebMCPProvider: FC = () => {
  useEffect(() => {
    // An embedding page must not inherit the tool surface — only the top-level
    // document the user explicitly opted into gets registered
    if (window.self !== window.top) {
      debugWebMCP('embedded in an iframe, skipping tool registration')
      return
    }
    const controller = new AbortController()
    initWebMCP(controller.signal).catch(error => {
      debugWebMCP('init failed:', error)
    })
    loadRelayEmbed()
    return () => controller.abort()
  }, [])

  return null
}
