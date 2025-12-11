# Pull Request Guidelines

This guide covers best practices for creating effective, reviewable pull requests for the Noodles.gl project.

## Creating Focused PRs

When implementing features or fixes:

- **Keep PRs focused**: Each PR should address a single concern or feature
- **Split large changes**: Separate unrelated changes into different PRs (e.g., separate AI chat changes from core app state changes)
- **Smaller is better**: Smaller PRs are easier to review thoroughly and catch issues
- **Context matters**: Make it easy for reviewers by keeping related changes together

### Example: What to Split

❌ **Too broad:**
- Add new operator + refactor state management + update documentation + fix unrelated bug

✅ **Well-focused:**
- PR 1: Add new operator with tests
- PR 2: Refactor state management
- PR 3: Update documentation
- PR 4: Fix unrelated bug

## What to Include in PRs

### Tests (Required)

Add tests for:
- New features and operators
- Bug fixes to prevent regressions
- Changes to critical components (see [Testing Guide](testing-guide.md))

### Documentation (When Applicable)

Update documentation when:
- Behavior changes or new features are added
- Complex operators need input/output documentation
- Edge cases or limitations need to be documented
- New patterns or conventions are introduced

#### Where to Document

- **Code comments** for implementation details
- **Operator reference pages** for user-facing behavior
- **AGENTS.md** for framework-level patterns and conventions (rarely)
- **dev-docs/** for development guides and detailed references
- **README files** for examples and walkthroughs

#### Example: Documenting Edge Cases

```typescript
// DuckDbOp: Multi-statement SQL support
// - Multiple statements separated by semicolons are executed sequentially
// - Only the result from the final SELECT is returned
// - Limitation: Semicolons inside string literals will incorrectly split statements
// - Use SET statements for configuration, CTEs for complex queries
```

### Test Runbook (For User-Facing Changes)

Provide clear instructions for manually testing changes in the UI.

**When to provide a runbook:**
- Feature additions or modifications to operators
- Bug fixes that affect user-visible behavior
- Changes to visualization or interaction behavior
- New integrations or data processing capabilities

See [Testing Guide - Test Runbooks](testing-guide.md#test-runbooks-for-prs) for detailed runbook guidelines.

## PR Description Template

Use this template for your PR descriptions:

```markdown
## Summary
[Brief description of what this PR does]

## Changes
- [List of specific changes made]
- [Another change]

## Testing
### Unit Tests
- [Describe unit tests added/modified]

### Manual Testing
[Provide test runbook - see guidelines below]

## Documentation
- [List documentation updates]
- [Or state "No documentation changes needed"]

## Related Issues
Fixes #[issue number]
```

## Manual Testing Runbook Guidelines

### Runbook Best Practices

1. **Keep it simple**: Assume the app is already running - don't include setup steps
2. **Use real nodes**: Create a minimal graph with actual operators that demonstrates the feature
3. **Provide noodles.json**: Include a complete project file that reviewers can load directly
4. **Clear expected results**: State exactly what should happen at each step
5. **Test both cases**: Cover both success and edge cases (e.g., enabled/disabled, valid/invalid)

### Example Runbook

```markdown
## Manual Testing in UI

### Setup
Save this file as `public/noodles/test-feature.noodles.json` and open with `?project=test-feature`

[Include noodles.json content here]

### Test Steps

1. **Test primary behavior:**
   - Open the project
   - Select the `/data-loader` node
   - Change `threshold` parameter to 50
   - Expected: Map should show only points with value > 50

2. **Test edge case:**
   - Set `threshold` to 0
   - Expected: All points should be visible

3. **Test animation:**
   - Open timeline
   - Keyframe `threshold` from 0 to 100 over 5 seconds
   - Play animation
   - Expected: Points should gradually disappear as threshold increases
```

### Include Complete Project File

Always include a `noodles.json` file that reviewers can save and load:

```json
{
  "version": 6,
  "nodes": [
    {
      "id": "/test-data",
      "type": "FileOp",
      "position": {"x": 100, "y": 100},
      "data": {
        "inputs": {
          "url": "@/data/sample.csv",
          "format": "csv"
        }
      }
    },
    {
      "id": "/viewer",
      "type": "ViewerOp",
      "position": {"x": 400, "y": 100},
      "data": {}
    }
  ],
  "edges": [
    {
      "id": "/test-data.out.data->/viewer.par.data",
      "source": "/test-data",
      "target": "/viewer",
      "sourceHandle": "out.data",
      "targetHandle": "par.data"
    }
  ],
  "viewport": {"x": 0, "y": 0, "zoom": 1}
}
```

## Code Review Checklist

Before requesting review, ensure:

- [ ] All tests pass locally
- [ ] Linter passes (`yarn lint` or `yarn fix-lint`)
- [ ] Type checker passes (`yarn typecheck`)
- [ ] Manual testing completed (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] Test runbook provided (for user-facing changes)
- [ ] Commit messages are clear and descriptive
- [ ] PR description follows template
- [ ] No unrelated changes included
- [ ] No commented-out code or debug statements
- [ ] No sensitive information (API keys, credentials, etc.)

## Common PR Patterns

### Adding a New Operator

**Checklist:**
- [ ] Operator class implemented
- [ ] Registered in operators.ts
- [ ] Added to category in categories.ts
- [ ] Unit tests added
- [ ] Example project provided for manual testing
- [ ] Documentation added (if complex)

### Fixing a Bug

**Checklist:**
- [ ] Root cause identified and documented
- [ ] Fix implemented
- [ ] Regression test added
- [ ] Manual test runbook provided
- [ ] Edge cases considered

### Refactoring

**Checklist:**
- [ ] No behavior changes
- [ ] All existing tests pass
- [ ] Code is simpler/clearer
- [ ] Performance impact measured (if applicable)
- [ ] Documentation updated (if patterns changed)

## Commit Message Guidelines

Use clear, descriptive commit messages:

```
<type>: <short summary>

<optional longer description>
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `refactor:` Code refactoring (no behavior change)
- `test:` Adding or updating tests
- `docs:` Documentation changes
- `perf:` Performance improvements
- `chore:` Maintenance tasks

**Examples:**
```
feat: add GeocoderOp for address-to-coordinate conversion

fix: prevent infinite loop in path resolution

refactor: simplify operator execution flow

test: add integration tests for graph serialization

docs: update operator API reference
```

## Responding to Review Feedback

- Address all comments, even if just to acknowledge
- Mark conversations as resolved when addressed
- If you disagree, explain your reasoning clearly
- Push fixup commits during review, squash before merge
- Re-request review after making significant changes

---

**Last Updated**: 2025-12-01
