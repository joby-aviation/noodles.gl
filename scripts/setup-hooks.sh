#!/bin/bash
# Setup git hooks for the project

# Create pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
# Pre-commit hook to validate example projects

# Check if any noodles.json files changed
if git diff --cached --name-only | grep -q "noodles-editor/src/examples/.*/noodles.json"; then
  echo "🔍 Validating example projects..."
  if ! npm run validate:examples --silent; then
    echo "❌ Example validation failed. Please fix the errors before committing."
    echo "Run: npm run validate:examples"
    exit 1
  fi
  echo "✓ All example projects are valid"
fi

exit 0
EOF

chmod +x .git/hooks/pre-commit
echo "✓ Git hooks installed successfully"
echo ""
echo "Pre-commit hook will now validate example projects before each commit."
echo "To bypass the hook temporarily, use: git commit --no-verify"
