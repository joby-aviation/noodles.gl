// Cloudflare Pages Advanced Mode worker
// Handles SPA routing for /app/* so client-side routes serve /app/index.html

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname

    if (pathname.startsWith('/app/')) {
      // Static assets (e.g. .js, .css, .wasm) are served directly
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname)
      if (hasExtension) {
        return env.ASSETS.fetch(request)
      }
      // Client-side routes: serve the SPA entry point
      return env.ASSETS.fetch(new URL('/app/index.html', url.origin))
    }

    // All other requests: serve static assets normally
    return env.ASSETS.fetch(request)
  },
}
