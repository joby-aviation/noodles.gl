// Cloudflare Pages Function to handle SPA routing for /app/*
// This serves /app/index.html for all routes under /app/ that don't match static files

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const pathname = url.pathname

  console.log('[SPA Function] Request:', {
    pathname,
    url: url.href,
    method: context.request.method,
  })

  // Check if the request is for a static asset (has a file extension)
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname)
  console.log('[SPA Function] Has extension:', hasExtension)

  if (hasExtension) {
    // Try to serve the static file
    console.log('[SPA Function] Attempting to serve static file')
    const response = await context.env.ASSETS.fetch(context.request)
    console.log('[SPA Function] Static file response status:', response.status)
    if (response.status !== 404) {
      return response
    }
    console.log('[SPA Function] Static file not found, falling through to index.html')
  }

  // For client-side routes without file extensions (or missing static files),
  // serve the SPA index.html
  const indexUrl = new URL('/app/index.html', url.origin)
  console.log('[SPA Function] Serving index.html from:', indexUrl.href)
  const indexResponse = await context.env.ASSETS.fetch(indexUrl)
  console.log('[SPA Function] Index response status:', indexResponse.status)
  return indexResponse
}
