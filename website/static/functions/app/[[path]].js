// Cloudflare Pages Function to handle SPA routing for /app/*
// This serves /app/index.html for all routes under /app/ that don't match static files

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const pathname = url.pathname

  // Check if the request is for a static asset (has a file extension)
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname)

  if (hasExtension) {
    // Let Cloudflare serve the static file
    return context.next()
  }

  // For client-side routes without file extensions, serve the SPA index.html
  return context.env.ASSETS.fetch(new URL('/app/', url.origin))
}
