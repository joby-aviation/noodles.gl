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

### Screenshots (Required for UI Changes)

Most reviewers can't judge a UI change from the diff alone. Any PR that changes what the user sees must include a screenshot, GIF or screen recording. This covers the node editor, properties panel, timeline, menus and dialogs, and the rendered map or visualization.

- **Show before and after**, labeled, side by side or one after the other
- **Use a GIF or recording for interactions** such as dragging, scrubbing, hover states, animations and timeline playback
- **Crop to the relevant area**, keeping enough surrounding UI to show where it is in the app
- **Add a one-line caption** on what to look for, e.g. "The edge now highlights on hover."
- **Don't commit screenshots** to the repo unless they are documentation assets. Attach them to the PR instead

Attach by dragging files into the PR description on GitHub, or from the CLI with `--attach` (on `gh pr create`, `gh pr edit` and `gh pr comment`). References in the body such as `![Before](./before.png)` are rewritten to the uploaded asset:

```bash
gh pr create --body-file body.md \
  --attach './before.png#Values cleared after rename' \
  --attach './after.png#Values kept after rename'
```

See the [Screenshot Guide](screenshot-guide.md) for capturing consistent screenshots, including with Chrome DevTools MCP.

## PR Description Template

GitHub fills in [`.github/pull_request_template.md`](../.github/pull_request_template.md) when you open a PR. Keep its headings and remove the optional ones that don't apply:

```markdown
Closes #123

#### Background
[Optional: 1-3 sentences on what is wrong or missing today and how this PR addresses it]

#### Change List
- [One bullet per operator, component, API or artifact changed]
- Unit tests

#### Screenshots
![Before](./before.png)
![After](./after.png)
[One-line caption on what to look for]

<details>
<summary>Test runbook</summary>

[Optional: runbook and noodles.json, see below]

</details>
```

### Description Tips

Adapted from the [deck.gl PR description guidelines](https://github.com/visgl/deck.gl/blob/master/dev-docs/pr-description-guidelines.md), which have many more examples. Reviewers read the description before the diff, and after merge it is the main record of _why_ a change was made.

- **Keep it short.** Most good descriptions are 300 to 900 characters, not counting a collapsed runbook. Length should follow how much reasoning is new to the reviewer, not the size of the diff
- **Link, don't repeat.** Use `Closes #123`, `For #123` (partial) or `Follow up of #123`. Remove the line if there is no issue, and name the PR that introduced a regression, e.g. `Introduced by #512`
- **Background: current behavior first, then the problem.** Stay concrete and quote the error, operator or line of code involved. Don't describe how good the solution is ("comprehensive", "robust", "clean")
- **Change List: one bullet per change, ten words or less.** Start with a verb or the name of the thing changed, e.g. `` `TableEditorOp`: preserve values on column rename``. Identifiers in backticks, no trailing periods, no file lists
- **Call out what a reviewer might question**: project migrations and version bumps, removed workarounds, deleted or skipped tests, breaking changes (with reasoning and impact as sub-bullets)
- **Say how it was verified in one line**, listing what was actually run, e.g. "Verified in the nyc-taxis example on Chrome and Safari." Don't leave checkboxes for the reviewer
- **State the scope.** Say what is left out on purpose under `#### TODO`, number multi-part PRs in the title (`Timeline markers (1/3)`), and ask open design questions under `#### Questions`
- **Leave out** restated titles, `Summary` / `Test plan` / `Validation` sections, tables of files, emoji, footers and links to tool sessions

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
- [ ] Linter passes (`npm run lint` or `npm run fix-lint`)
- [ ] Type checker passes (`npm run typecheck`)
- [ ] Manual testing completed (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] Screenshot, GIF or recording attached (for UI changes)
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

**Last Updated**: 2026-09-24
