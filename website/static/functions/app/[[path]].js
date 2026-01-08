// Cloudflare Pages Function to handle SPA routing for /app/*
// This serves /app/index.html for all routes under /app/ that don't match static files

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const pathname = url.pathname

  // Check if the request is for a static asset (has a file extension)
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname)

  if (hasExtension) {
    // Try to serve the static file
    const response = await context.env.ASSETS.fetch(context.request)
    if (response.status !== 404) {
      return response
    }
    // If static file not found, fall through to serve index.html
  }

  // For client-side routes without file extensions (or missing static files),
  // serve the SPA index.html
  return context.env.ASSETS.fetch(new URL('/app/index.html', url.origin))
}
