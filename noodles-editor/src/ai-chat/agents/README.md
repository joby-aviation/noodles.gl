# AI Chat Agents

This directory contains specialized agents that extend the capabilities of the Noodles.gl AI chat system.

## Available Agents

### 1. Project Generator Agent

**Purpose**: Generate complete Noodles.gl projects from natural language descriptions.

**Usage**: Available in AI chat via the `generate_project` tool.

**Capabilities**:
- Infers visualization type from description (scatter, heatmap, arc, path, etc.)
- Automatically creates complete data pipeline: Data → Layer → Renderer → Viewer
- Generates accessor functions for layer properties
- Adds basemap configuration
- Validates generated project structure

**Example**:
```
User: "Create a scatterplot showing earthquake data"
Claude: *uses generate_project tool*
Result: Complete project with FileOp, ScatterplotLayerOp, position accessor, DeckRenderer, basemap, and Viewer
```

**Files**:
- [`project-generator.ts`](./project-generator.ts) - Main agent implementation
- [`project-templates.ts`](./project-templates.ts) - Reusable templates and patterns

### 2. Refactoring Assistant Agent

**Purpose**: Analyze operator code for quality issues and suggest improvements.

**Usage**: Available in AI chat via multiple tools:
- `analyze_operator_code` - Full code quality analysis
- `find_code_duplicates` - Find duplicate code patterns
- `suggest_operator_refactorings` - Get specific refactoring suggestions

**Capabilities**:
- Detects purity violations (side effects in execute())
- Checks for type safety issues
- Validates documentation completeness
- Identifies performance problems
- Finds duplicate code blocks
- Suggests best practice improvements

**Example**:
```
User: "Analyze ScatterplotLayerOp for improvements"
Claude: *uses analyze_operator_code tool*
Result: List of issues (missing docs, type annotations, etc.) and suggestions
```

**Files**:
- [`refactoring-assistant.ts`](./refactoring-assistant.ts) - Code analysis implementation

### 3. Migration Generator Agent

**Purpose**: Generate schema migration files for operator changes.

**Usage**: CLI tool for developers (not available in AI chat)

**Capabilities**:
- Generates TypeScript migration code (up/down functions)
- Supports multiple change types:
  - `rename_field` - Rename input/output fields
  - `rename_operator` - Rename operator types
  - `change_default` - Change default values
  - `add_field` - Add new required fields
  - `remove_field` - Remove fields
- Auto-generates test files
- Auto-increments version numbers

**Example**:
```bash
$ yarn generate:migration
Operator type: ScatterplotLayerOp
Change type: rename_field
Input or output? out
Old field name: layer
New field name: deckLayer
Result: Creates migration files in __migrations__/
```

**Files**:
- [`migration-generator.ts`](./migration-generator.ts) - Migration code generation
- [`../../scripts/generate-migration.ts`](../../scripts/generate-migration.ts) - CLI interface

## Architecture

### Integration with AI Chat

Agents are integrated into the AI chat system through the MCPTools class:

```typescript
// mcp-tools.ts
import { ProjectGeneratorAgent } from './agents/project-generator'
import { RefactoringAssistantAgent } from './agents/refactoring-assistant'

export class MCPTools {
  private projectGenerator: ProjectGeneratorAgent
  private refactoringAssistant: RefactoringAssistantAgent

  constructor(contextLoader: ContextLoader) {
    this.projectGenerator = new ProjectGeneratorAgent(contextLoader)
    this.refactoringAssistant = new RefactoringAssistantAgent(contextLoader)
  }

  async generateProject(params) {
    return await this.projectGenerator.generateProject(params)
  }
}
```

Tools are then registered in ClaudeClient and become available to Claude:

```typescript
// claude-client.ts
private getTools(): Anthropic.Tool[] {
  return [
    {
      name: 'generate_project',
      description: 'Generate a complete project...',
      input_schema: { /* ... */ }
    },
    // ...
  ]
}
```

### Agent Design Patterns

All agents follow these principles:

1. **Single Responsibility**: Each agent has one clear purpose
2. **Read-Only by Default**: Agents analyze and suggest but don't modify code directly
3. **Context-Aware**: Agents leverage the ContextLoader for codebase knowledge
4. **Validation**: Generated outputs are validated before being returned
5. **Testable**: Agent logic is separated from I/O for easy testing

### Context Loading

Agents have access to pre-loaded context bundles via `ContextLoader`:

- **Code Index**: All source files with symbols and exports
- **Operator Registry**: Schemas for all operators
- **Documentation Index**: Searchable docs
- **Examples Index**: All example projects

This provides rich context without consuming tokens on every request.

## Adding New Agents

To add a new agent:

1. **Create agent class** in this directory:
```typescript
export class NewAgent {
  constructor(private contextLoader: ContextLoader) {}

  async doSomething(params: Params): Promise<Result> {
    // Implementation
  }
}
```

2. **Add to MCPTools** ([`../mcp-tools.ts`](../mcp-tools.ts)):
```typescript
private newAgent: NewAgent

constructor(contextLoader: ContextLoader) {
  this.newAgent = new NewAgent(contextLoader)
}

async newAgentMethod(params: Params): Promise<ToolResult> {
  const result = await this.newAgent.doSomething(params)
  return { success: true, data: result }
}
```

3. **Register tool** in ClaudeClient ([`../claude-client.ts`](../claude-client.ts)):
```typescript
private getTools(): Anthropic.Tool[] {
  return [
    {
      name: 'new_agent_tool',
      description: 'What this tool does...',
      input_schema: { /* Anthropic tool schema */ }
    },
  ]
}

private async executeTool(name: string, params: any) {
  const methodMap = {
    new_agent_tool: p => this.tools.newAgentMethod(p),
  }
}
```

4. **Add tests** for the agent logic

## Testing

Agents should have comprehensive unit tests:

```typescript
// project-generator.test.ts
import { describe, expect, it } from 'vitest'
import { ProjectGeneratorAgent } from './project-generator'

describe('ProjectGeneratorAgent', () => {
  it('should generate valid project', async () => {
    const agent = new ProjectGeneratorAgent(mockContextLoader)
    const result = await agent.generateProject({
      description: 'earthquake visualization'
    })

    expect(result.nodes).toBeDefined()
    expect(result.edges).toBeDefined()
  })
})
```

## Best Practices

### For AI Chat Agents

- **Validate inputs** before processing
- **Return structured data** that the chat UI can display
- **Provide detailed error messages** for debugging
- **Keep operations atomic** - one tool call = one complete operation
- **Consider token usage** - large results should be summarized

### For CLI Agents

- **Interactive prompts** for complex input
- **Validate user input** before generating files
- **Preview changes** before writing to disk
- **Provide clear next steps** after generation
- **Generate working code** that passes linting and tests

## Future Enhancements

Potential future agents:

1. **Test Generator Agent**: Generate comprehensive test suites for operators
2. **Documentation Generator**: Auto-generate operator reference docs
3. **Example Builder**: Create example projects from templates
4. **Performance Profiler**: Analyze and suggest performance optimizations
5. **Dependency Analyzer**: Track operator dependencies and suggest updates

## Resources

- [AI Chat System Overview](../README.md)
- [MCPTools Documentation](../mcp-tools.ts)
- [Operator Development Guide](../../noodles/README.md)
- [Migration System](../../noodles/__migrations__/README.md)
