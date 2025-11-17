#!/bin/bash
set -e

# Script to setup platform-specific deployment configuration
# This script can be called from CI/CD workflows

DEPLOYMENT_TYPE="${1:-github-pages}"

echo "Setting up deployment configuration for: $DEPLOYMENT_TYPE"

# Setup platform-specific configuration
if [ "$DEPLOYMENT_TYPE" = "cloudflare" ]; then
  echo "Setting up CloudFlare Pages configuration..."

  # Create _redirects file for CloudFlare Pages in the website build directory
  # This handles SPA routing for the app at /app/*
  cat > ./website/build/_redirects << 'EOF'
# SPA routing for the app - redirect any /app/* path that's not a file to /app/index.html
# Exclude index.html itself to avoid infinite loop
/app/index.html  200
/app/*  /app/index.html  200
EOF
  echo "✓ Created _redirects file for CloudFlare Pages"

elif [ "$DEPLOYMENT_TYPE" = "github-pages" ]; then
  echo "GitHub Pages configuration..."
  echo "✓ 404.html already in place from app build"
fi

echo "✅ Deployment configuration ready for $DEPLOYMENT_TYPE"
