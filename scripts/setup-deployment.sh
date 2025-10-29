#!/bin/bash
set -e

# Script to setup deployment structure for both GitHub Pages and CloudFlare Pages
# This script can be called from CI/CD workflows

DEPLOYMENT_TYPE="${1:-github-pages}"

echo "Setting up deployment structure for: $DEPLOYMENT_TYPE"

# Create deployment directory structure
mkdir -p ./deployment
echo "✓ Created deployment directory"

# Copy website (docs) to root
cp -r ./website/build/* ./deployment/
echo "✓ Copied website to deployment root"

# Copy app to /app subdirectory
mkdir -p ./deployment/app
cp -r ./noodles-editor/dist/* ./deployment/app/
echo "✓ Copied app to /app subdirectory"

# Setup platform-specific configuration
if [ "$DEPLOYMENT_TYPE" = "cloudflare" ]; then
  echo "Setting up CloudFlare Pages configuration..."

  # Create _redirects file for CloudFlare Pages
  # This handles SPA routing for the app at /app/*
  cat > ./deployment/_redirects << 'EOF'
# SPA routing for the app - redirect any /app/* path that's not a file to /app/index.html
/app/*  /app/index.html  200
EOF
  echo "✓ Created _redirects file for CloudFlare Pages"

elif [ "$DEPLOYMENT_TYPE" = "github-pages" ]; then
  echo "GitHub Pages configuration..."
  echo "✓ 404.html already in place from app build"
fi

echo "✅ Deployment structure ready for $DEPLOYMENT_TYPE"
