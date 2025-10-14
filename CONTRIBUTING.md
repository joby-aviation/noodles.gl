# Contributing to Noodles.gl

Welcome to Noodles.gl! We're excited to have you contribute.

## 🚀 Quick Start

This guide covers development workflows, testing strategies, and contribution guidelines for the Noodles.gl system.

### Prerequisites

- **Node.js** (managed by Volta)
- **Yarn** with PnP mode
- Modern browser with WebGL support

### Setup

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
yarn install

# Start development server
yarn start
```

### Development URLs

- **Local Development**: `http://localhost:5173/?project=example`
- **Specific Project**: Replace `example` with project name from `/public/noodles/`
- **Safe Mode**: Add `&safeMode=true` to disable code execution

## 📁 Project Structure

For detailed information about the codebase structure and architecture, see:

- [Architecture Overview](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/architecture.md) - Complete project structure and patterns
- [Technology Stack](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/tech-stack.md) - Full tech stack details

## 🛠️ Development Workflow

### Available Commands

For complete development commands and code style guidelines, see [Development Guide](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/developing.md).

Key commands:

```bash
yarn start          # Development server
yarn build          # Production build
yarn test           # Run all tests
yarn lint           # Check code quality
yarn fix-lint       # Auto-fix linting issues
```

## 🧪 Testing

We use **Vitest** for testing with these patterns:

- Unit tests co-located with source files (`*.test.ts`)
- Mock data and snapshot testing
- Browser testing with Playwright for integration tests

```bash
# Run specific test patterns
yarn test src/utils/color.test.ts
yarn test src/visualizations/noodles/
```

## 🎨 Architecture Overview

For detailed architecture information, see [Architecture Guide](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/architecture.md).

Key concepts:

- **Node-based system** for visual programming
- **[Theatre.js](https://www.theatrejs.com/)** integration for timeline control
- **[Deck.gl](https://deck.gl/) + [MapLibre](https://maplibre.org/)** for 3D visualizations

## 🌟 Contributing Guidelines

### Before You Start

1. **Check existing issues** for similar work or discussion
2. **Create an issue** for significant changes or new features
3. **Fork the repository** and create a feature branch

### Making Changes

1. **Follow the code style** [guidelines](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/developing.md)
2. **Write tests** for new functionality
3. **Migration Scripts**: Add any necessary migrations
4. **Update documentation** if needed
5. **Run linting** before committing: `yarn fix-lint`
6. **Ensure tests pass**: `yarn test`

### Pull Request Process

1. **Create descriptive PR title** and description
2. **Link related issues** in the PR description
3. **Ensure CI passes** (linting, tests, build)
4. **Request review** from maintainers
5. **Address feedback** promptly

### Commit Message Format

Use clear, descriptive commit messages:

```
feat: add new geospatial visualization node
fix: resolve Theatre.js timeline synchronization issue
docs: update API documentation for operators
refactor: improve performance of arc geometry calculations
```

## 🐛 Reporting Issues

When reporting bugs or requesting features:

1. **Search existing issues** first
2. **Use issue templates**
3. **Provide clear reproduction steps**
4. **Include system information** (OS, browser, Node version)
5. **Add relevant code samples** or screenshots

## 📚 Additional Resources

- [Product Overview](https://github.com/joby-aviation/noodles.gl/blob/main/docs/product.md) - What Noodles.gl does and key features
- [Development Guide](https://github.com/joby-aviation/noodles.gl/blob/main/docs/developing.md) - Additional development commands

## 🤝 Community

We welcome contributions of all kinds:
- 🐛 **Bug fixes** and issue reports
- ✨ **New features** and enhancements
- 📖 **Documentation** improvements
- 🧪 **Tests** and quality improvements
- 💡 **Ideas** and architectural discussions

## 📝 License

By contributing to Noodles.gl, you agree that your contributions will be licensed under the same license as the project, Apache 2.0.

---

Thank you for contributing to Noodles.gl! Your efforts help make geospatial visualization and animation more accessible to everyone. 🚀
