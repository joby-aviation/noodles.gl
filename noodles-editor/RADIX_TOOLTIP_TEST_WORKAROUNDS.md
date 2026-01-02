# Radix Tooltip Test Workarounds

Research findings from investigating the test hang issue.

## Key Discovery
**Radix UI itself uses Vitest** for testing - so this should be solvable!

## Workarounds to Try (in order)

**Note:** Tests hang for HOURS (confirmed deadlock, not timeout). Focus on architectural solutions.

### 1. ❌ Manual Mock File (TRIED - DIDN'T WORK)
Create a manual mock that Vitest picks up automatically.

**Steps:**
```bash
mkdir -p src/__mocks__/@radix-ui
```

Create `src/__mocks__/@radix-ui/react-tooltip.tsx`:
```typescript
export const Provider = ({ children }: any) => children
export const Root = ({ children }: any) => children
export const Trigger = ({ children }: any) => children
export const Portal = () => null
export const Content = () => null
export const Arrow = () => null
```

**Result:** ❌ STILL HANGS
- Created `src/__mocks__/@radix-ui/react-tooltip.tsx` with simple mock components
- Tests still timeout during module import
- Manual mocks don't prevent the initial import from hanging

---

### 2. Different Mock Pattern for Namespace Imports
The `import * as Tooltip` might be the issue.

```typescript
vi.mock('@radix-ui/react-tooltip', () => {
  return {
    __esModule: true,
    default: {},
    ...Object.fromEntries(
      ['Provider', 'Root', 'Trigger', 'Portal', 'Content', 'Arrow'].map(name => [
        name,
        ({ children }: any) => children
      ])
    )
  }
})
```

---

### 3. ❌ Increase Timeouts (NOT THE ISSUE)
~~Maybe it's just slow initialization?~~

**Confirmed:** Tests hang for HOURS, not seconds. This is a deadlock/infinite loop, not a timeout issue.
- Increasing timeouts won't help
- Skip this workaround entirely

---

### 4. Environment-Based Conditional Import
Refactor component to avoid Radix in tests.

```typescript
const Tooltip = import.meta.env.VITEST
  ? await import('./test-tooltip-mock')
  : await import('@radix-ui/react-tooltip')
```

---

### 5. Refactor Tooltip to Separate Component
Extract tooltip usage to reduce coupling:

```typescript
// TooltipWrapper.tsx
export const TooltipWrapper = ({ children, content }) => {
  if (process.env.NODE_ENV === 'test') {
    return children
  }
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>{content}</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
```

---

## Root Cause Hypothesis
Given that tests hang for HOURS (not seconds), this is a **deadlock or infinite loop**, not slow initialization.

Most likely causes:
1. **Infinite loop in module initialization**: Radix Tooltip may have circular dependencies or initialization that never completes
2. **Portal/DOM polling**: Component may be polling for DOM elements that never appear in test environment
3. **Event listener deadlock**: Waiting for browser events that never fire in vitest browser mode
4. **Namespace import + browser mode conflict**: `import * as Tooltip` creates a sealed object that vitest can't properly mock in browser mode

~~Async initialization~~ - ruled out since it would timeout, not hang indefinitely

---

## Files Involved
- `src/noodles/components/__tests__/node-tree-sidebar.test.tsx.skip`
- `src/noodles/components/node-tree-sidebar.tsx`
- `vitest.config.ts`
- `src/setupTests.ts`

---

## References
- Radix UI uses Vitest internally (confirmed from package.json)
- Vitest manual mocking: https://vitest.dev/guide/mocking.html
- No documented issues found on GitHub for this specific problem
