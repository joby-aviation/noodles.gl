# Deployment Scripts

This directory contains scripts for deploying Noodles.gl to various platforms.

## setup-deployment.sh

Creates the deployment structure for both GitHub Pages and CloudFlare Pages.

### Usage

```bash
# For GitHub Pages (default)
./scripts/setup-deployment.sh github-pages

# For CloudFlare Pages
./scripts/setup-deployment.sh cloudflare
```

### What it does

1. Creates a `./deployment` directory
2. Copies the website build to the root
3. Copies the app build to `/app` subdirectory
4. Sets up platform-specific configuration:
   - **GitHub Pages**: Uses the existing 404.html SPA redirect mechanism
   - **CloudFlare Pages**: Creates a `_redirects` file for SPA routing

### Prerequisites

Before running this script, ensure you have:
1. Built the website: `cd website && yarn build`
2. Built the app: `cd noodles-editor && yarn build`

Or use the root-level build commands:
```bash
yarn build:all           # For GitHub Pages
yarn build:all:cloudflare # For CloudFlare Pages (uses CDN for DuckDB)
```

## CloudFlare Pages Deployment

For CloudFlare Pages, use the following build settings:

### Build Configuration
- **Build command**: `yarn build:all:cloudflare && ./scripts/setup-deployment.sh cloudflare`
- **Build output directory**: `deployment`
- **Root directory**: (leave as root, or `/`)
- **Node version**: 22

### Environment Variables
Set these in CloudFlare Pages dashboard under Settings > Environment Variables:
- `NODE_VERSION=22` (optional, can also be set in build settings)

### How it works

CloudFlare Pages uses a `_redirects` file instead of 404.html for handling SPA routing. The script automatically creates this file with the correct rules:

```
# SPA routing for the app - redirect any /app/* path that's not a file to /app/index.html
/app/*  /app/index.html  200
```

This ensures that routes like `/app/examples/nyc-taxis` are properly handled by the React app.
