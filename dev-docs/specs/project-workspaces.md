# Workspace Architecture with Command Pattern & Zustand

## Overview
Refactor menu.tsx to use a clean, maintainable architecture combining:
- **Async generator commands** for linear operation flows
- **Promise-based dialogs** for user interactions
- **Zustand actions/effects** for state management and side effects
- **File system as database** for recent projects (no manual tracking)

This eliminates callback hell, scattered state, and storage type branching.

---

## Key Design Principles

### 1. Workspace Type (Discriminated Union)
```typescript
type Workspace =
  | { type: 'folder'; name: string; handle: FileSystemDirectoryHandle }
  | { type: 'browserStorage'; name: string }
  | { type: 'examples'; name: string }
```

**Type Safety:**
- ✅ Folder workspaces **always** have `handle` (enforced by TypeScript)
- ✅ browserStorage/examples **never** have `handle` (enforced by TypeScript)
- ✅ Discriminated union enables automatic type narrowing
- ✅ Eliminates 11+ defensive runtime checks

### 2. Simplified Workspace Cache
```typescript
interface CachedWorkspaceEntry {
  name: string                      // User-provided workspace name
  handle: FileSystemDirectoryHandle // For accessing files
  lastAccessed: Date                // When workspace was last used
  cached: Date                      // When first cached
}
```

**What we track manually:**
- ✅ Only workspace `lastAccessed` (for workspace recency)

**What we don't track:**
- ❌ No `lastProject` field - not needed
- ❌ No per-project `lastOpened` timestamps
- ❌ No localStorage for recent projects

### 3. Recent Projects from File System
"Open Recent" shows the 5 most recently modified projects in the **current workspace**:

```typescript
async function getRecentProjects(workspace: Workspace): Promise<ProjectInfo[]> {
  const projects = await listProjects(workspace)

  // Each project has file.lastModified from noodles.json
  return projects
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 5)
}
```

**Benefits:**
- ✅ `file.lastModified` automatically updated by OS on save
- ✅ Always accurate, never stale
- ✅ No manual tracking needed
- ✅ Works across all workspace types
- ✅ Workspace-scoped (shows projects in current workspace)

### 4. Performance
- `.getFile()` on noodles.json is **fast** (metadata only, not file contents)
- 50 projects = ~50ms to scan and sort
- More than fast enough for UI

---

## Architecture Design

### Command Pattern with Async Generators
Operations are async generators that yield dialog requests:

```typescript
async function* saveProjectOperation() {
  // Linear flow, yields pauses for user input
  const workspace = yield ensureWorkspace()
  const name = yield ensureProjectName()
  const confirmed = yield checkAndConfirmOverwrite(workspace, name)
  if (!confirmed) return
  
  await executeProjectSave(workspace, name)
}
```

### Promise-based Dialog API
Dialogs resolve with user choices:

```typescript
// Dialog opens and returns Promise
const workspace = await dialogAPI.selectWorkspace({ prompt: 'Select workspace' })
const name = await dialogAPI.promptProjectName({ defaultName: 'my-project' })
```

### Zustand Store with Actions/Effects
Centralized state management:

```typescript
// Store actions dispatch effects
const store = useMenuStore()
store.runOperation('save')  // Dispatches save operation

// Store manages:
// - Current workspace/project
// - Operation state (idle, running, error)
// - Dialog state (which dialog to show)
// - Recent workspaces
```

---

## Implementation Plan

### Phase 1: Core Architecture

#### Task 1.1: Create dialog API with Promise-based interface
**File**: `noodles-editor/src/noodles/components/dialog-api.tsx` (new)
**Changes**:
- Create `DialogAPI` class with Promise-returning methods:
  - `selectWorkspace(options?): Promise<Workspace | null>`
  - `promptProjectName(options?): Promise<string | null>`
  - `confirmReplace(projectName): Promise<boolean>`
  - `confirmDelete(projectName): Promise<boolean>`
  - `showError(error): Promise<void>`
- Create `DialogProvider` component that renders active dialog
- Use React context to provide DialogAPI instance
- Single `DialogContainer` component that shows one dialog at a time
- Each dialog method:
  - Sets dialog state (which dialog to show, with props)
  - Returns Promise that resolves when user completes dialog
  - Resolves with result or null if cancelled

**Example API**:
```typescript
class DialogAPI {
  private setState: (state: DialogState) => void
  
  selectWorkspace(options?: { prompt?: string }): Promise<Workspace | null> {
    return new Promise((resolve) => {
      this.setState({
        type: 'workspace-picker',
        props: { prompt: options?.prompt, onComplete: resolve }
      })
    })
  }
  
  promptProjectName(options?: { 
    defaultName?: string,
    validateExists?: boolean 
  }): Promise<string | null> {
    return new Promise((resolve) => {
      this.setState({
        type: 'project-name',
        props: { ...options, onComplete: resolve }
      })
    })
  }
  
  confirmDelete(projectName: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.setState({
        type: 'confirm-delete',
        props: { projectName, onComplete: resolve }
      })
    })
  }
}
```

#### Task 1.2: Create operation runner for async generators
**File**: `noodles-editor/src/noodles/utils/operation-runner.ts` (new)
**Changes**:
- Create `runOperation()` function that executes async generators
- Handles yielded dialog requests by calling DialogAPI
- Passes dialog results back to generator
- Error handling and cancellation support
- Integration with Zustand store for state updates

**Example**:
```typescript
async function runOperation<T>(
  generator: AsyncGenerator<DialogRequest, T>,
  dialogAPI: DialogAPI,
  onProgress?: (state: string) => void
): Promise<T> {
  let lastResult: any = undefined
  
  while (true) {
    const { value, done } = await generator.next(lastResult)
    
    if (done) return value
    
    // value is a dialog request
    const dialogResult = await executeDialogRequest(value, dialogAPI)
    
    if (dialogResult === null) {
      // User cancelled
      await generator.return(undefined)
      throw new CancellationError()
    }
    
    lastResult = dialogResult
  }
}
```

#### Task 1.3: Define operation types and dialog requests
**File**: `noodles-editor/src/noodles/operations/types.ts` (new)
**Changes**:
- Define `DialogRequest` union type for all dialog types
- Define operation result types
- Define operation error types

```typescript
type DialogRequest = 
  | { type: 'select-workspace', prompt?: string }
  | { type: 'prompt-name', defaultName?: string, validateExists?: boolean }
  | { type: 'confirm-replace', projectName: string }
  | { type: 'confirm-delete', projectName: string }
  | { type: 'confirm-action', title: string, message: string }

type OperationResult<T> = 
  | { success: true, value: T }
  | { success: false, error: OperationError, cancelled: boolean }
```

---

### Phase 2: Zustand Menu Store

#### Task 2.1: Create menu operations store
**File**: `noodles-editor/src/noodles/stores/menu-store.tsx` (new)
**Changes**:
- Create Zustand store for menu operations
- State:
  ```typescript
  {
    // Operation state
    currentOperation: string | null
    operationState: 'idle' | 'running' | 'error'
    operationError: Error | null
    
    // Dialog state (managed by dialog API)
    activeDialog: DialogState | null
    
    // Data (from filesystem-store, imported)
    currentWorkspace: Workspace | null
    activeProject: string | null
    recentWorkspaces: Workspace[]
  }
  ```
- Actions:
  ```typescript
  {
    // Operation execution
    runOperation: (name: string, ...args: any[]) => Promise<void>
    cancelOperation: () => void
    
    // Dialog management (called by DialogAPI)
    setActiveDialog: (dialog: DialogState | null) => void
    
    // Side effects (save, load, delete, etc.)
    saveProject: (workspace, name, data) => Promise<void>
    loadProject: (workspace, name) => Promise<void>
    deleteProject: (workspace, name) => Promise<void>
    
    // Cache/recent updates
    updateRecent: (workspace, project) => void
  }
  ```

#### Task 2.2: Integrate with filesystem-store
**File**: `noodles-editor/src/noodles/filesystem-store.tsx`
**Changes**:
- Keep workspace/project state here
- Export selectors for menu-store to use
- Menu-store calls filesystem-store actions for workspace/project updates
- Clear separation: filesystem-store = data, menu-store = operations

---

### Phase 3: Operation Implementations

#### Task 3.1: Implement New Project operation
**File**: `noodles-editor/src/noodles/operations/new-project.ts` (new)
**Changes**:
```typescript
export async function* newProjectOperation(
  context: OperationContext
): AsyncGenerator<DialogRequest, void> {
  // Ensure workspace selected
  if (!context.workspace) {
    const workspace = yield { type: 'select-workspace' }
    if (!workspace) return
    context.setWorkspace(workspace)
  }
  
  // Check read-only
  if (context.workspace.type === 'examples') {
    yield { type: 'error', message: 'Cannot create in read-only workspace' }
    return
  }
  
  // Get project name
  const name = yield { type: 'prompt-name' }
  if (!name) return
  
  // Check conflict
  const exists = await context.checkProjectExists(context.workspace, name)
  if (exists) {
    const replace = yield { type: 'confirm-replace', projectName: name }
    if (!replace) return
  }
  
  // Create and save
  const newProject = context.getNewProjectTemplate()
  await context.saveProject(context.workspace, name, newProject)
  
  // Update state
  context.setActiveProject(name)
  context.updateURL(context.workspace.name, name)
  context.updateRecent(context.workspace, name)
}
```

#### Task 3.2: Implement Import Project operation
**File**: `noodles-editor/src/noodles/operations/import-project.ts` (new)
**Changes**:
```typescript
export async function* importProjectOperation(
  context: OperationContext
): AsyncGenerator<DialogRequest, void> {
  // Select file
  const fileHandle = yield { type: 'select-file', accept: '.json' }
  if (!fileHandle) return
  
  // Read and parse
  const file = await fileHandle.getFile()
  const json = JSON.parse(await file.text())
  const migrated = await migrateProject(json)
  
  // Extract basename for default name
  const defaultName = extractBasename(file.name)
  
  // Rest follows new-project pattern
  if (!context.workspace) {
    const workspace = yield { type: 'select-workspace' }
    if (!workspace) return
    context.setWorkspace(workspace)
  }
  
  if (context.workspace.type === 'examples') {
    yield { type: 'error', message: 'Cannot import to read-only workspace' }
    return
  }
  
  const name = yield { type: 'prompt-name', defaultName }
  if (!name) return
  
  // Check conflict and save
  const exists = await context.checkProjectExists(context.workspace, name)
  if (exists) {
    const replace = yield { type: 'confirm-replace', projectName: name }
    if (!replace) return
  }
  
  await context.saveProject(context.workspace, name, migrated)
  
  // Update state
  context.setActiveProject(name)
  context.updateURL(context.workspace.name, name)
  context.updateRecent(context.workspace, name)
}
```

#### Task 3.3: Implement Open Project operation
**File**: `noodles-editor/src/noodles/operations/open-project.ts` (new)
**Changes**:
```typescript
export async function* openProjectOperation(
  context: OperationContext
): AsyncGenerator<DialogRequest, void> {
  // Select workspace (with recent workspaces list)
  const workspace = yield { 
    type: 'select-workspace',
    showRecent: true 
  }
  if (!workspace) return
  
  // If folder workspace, prompt for name (if not already named)
  if (workspace.type === 'folder' && !workspace.name) {
    const name = yield { 
      type: 'name-workspace',
      defaultName: workspace.handle.name 
    }
    if (!name) return
    workspace.name = name
    await context.cacheWorkspace(workspace)
  }
  
  // List projects in workspace
  const projects = await context.listProjects(workspace)
  
  // Select project
  const projectName = yield { 
    type: 'select-project',
    workspace,
    projects 
  }
  if (!projectName) return
  
  // Load project
  await context.loadProject(workspace, projectName)
  
  // Update state
  context.setWorkspace(workspace)
  context.setActiveProject(projectName)
  context.updateURL(workspace.name, projectName)
  context.updateRecent(workspace, projectName)
}
```

#### Task 3.4: Implement Delete Project operation
**File**: `noodles-editor/src/noodles/operations/delete-project.ts` (new)
**Changes**:
```typescript
export async function* deleteProjectOperation(
  context: OperationContext,
  projectName: string
): AsyncGenerator<DialogRequest, void> {
  // Ensure workspace exists
  if (!context.workspace) {
    yield { type: 'error', message: 'No workspace selected' }
    return
  }
  
  // Check read-only
  if (context.workspace.type === 'examples') {
    yield { type: 'error', message: 'Cannot delete from read-only workspace' }
    return
  }
  
  // Confirm deletion with "Are you sure?" guard
  const confirmed = yield { 
    type: 'confirm-delete', 
    projectName 
  }
  if (!confirmed) return
  
  // Delete project
  await context.deleteProject(context.workspace, projectName)
  
  // If deleted project was active, clear it
  if (context.activeProject === projectName) {
    context.setActiveProject(null)
    context.updateURL(context.workspace.name, null)
  }
  
  // Update recent projects
  context.removeFromRecent(context.workspace, projectName)
}
```

**Note**: This operation is called from the project list dialog's delete button, or from a menu item with the current project as target.

#### Task 3.5: Implement Save, Save As, Switch Workspace operations
**Files**: 
- `noodles-editor/src/noodles/operations/save-project.ts`
- `noodles-editor/src/noodles/operations/save-as-project.ts`
- `noodles-editor/src/noodles/operations/switch-workspace.ts`
**Changes**: Similar patterns using async generators that yield dialog requests

---

### Phase 4: Dialog Components (Refactored)

#### Task 4.1: Refactor dialogs to use Promise-based API
**Files**:
- `noodles-editor/src/noodles/components/workspace-picker-dialog.tsx` (new)
- `noodles-editor/src/noodles/components/workspace-name-dialog.tsx` (new)
- `noodles-editor/src/noodles/components/project-name-dialog.tsx` (refactor SaveProjectDialog)
- `noodles-editor/src/noodles/components/project-list-dialog.tsx` (new)
- `noodles-editor/src/noodles/components/confirm-dialog.tsx` (refactor ReplaceProjectDialog)
- `noodles-editor/src/noodles/components/confirm-delete-dialog.tsx` (new)

**Changes for each dialog**:
- Accept `onComplete: (result: T | null) => void` prop
- Call `onComplete(result)` when user confirms
- Call `onComplete(null)` when user cancels
- Remove internal state management (now in dialog API)
- Simplified component just renders UI and calls callback

**Example - ConfirmDeleteDialog**:
```typescript
function ConfirmDeleteDialog({ 
  projectName,
  onComplete 
}: {
  projectName: string
  onComplete: (confirmed: boolean) => void
}) {
  return (
    <Dialog.Root open onOpenChange={() => onComplete(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title>Delete project?</Dialog.Title>
          <Dialog.Description>
            Are you sure you want to delete "{projectName}"? This action cannot be undone.
          </Dialog.Description>
          <div className={s.dialogRightSlot}>
            <button onClick={() => onComplete(false)}>Cancel</button>
            <button className={s.red} onClick={() => onComplete(true)}>
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

#### Task 4.2: Update ProjectListDialog to support delete
**File**: `noodles-editor/src/noodles/components/project-list-dialog.tsx`
**Changes**:
- Show delete button (trash icon) for each project
- When delete clicked: Call `runOperation('delete-project', projectName)`
- Delete operation handles confirmation dialog
- After delete completes, refresh project list
- Disable delete button for Examples workspace

---

### Phase 5: Refactor Menu Component

#### Task 5.1: Simplify menu.tsx to use operation runner
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Remove all useState hooks for dialog management
- Remove all callback functions (maybeSetProjectName, onReplaceProject, etc.)
- Remove storage type branching logic
- Remove delete function (lines 262-274) - now an operation
- Replace with simple operation calls:

```typescript
export function Menu({ ... }) {
  const { runOperation } = useMenuStore()
  const dialogAPI = useDialogAPI()
  const currentProject = useActiveProject()
  
  return (
    <Menubar.Root>
      <Menubar.Menu>
        <Menubar.Item onSelect={() => runOperation('new-project')}>
          New Project
        </Menubar.Item>
        <Menubar.Item onSelect={() => runOperation('import-project')}>
          Import
        </Menubar.Item>
        <Menubar.Item onSelect={() => runOperation('open-project')}>
          Open...
        </Menubar.Item>
        <Menubar.Item onSelect={() => runOperation('save-project')}>
          Save
        </Menubar.Item>
        <Menubar.Item onSelect={() => runOperation('save-as-project')}>
          Save As...
        </Menubar.Item>
        <Menubar.Item onSelect={() => runOperation('switch-workspace')}>
          Switch Workspace...
        </Menubar.Item>
        {currentProject && (
          <Menubar.Item onSelect={() => runOperation('delete-project', currentProject)}>
            Delete Project...
          </Menubar.Item>
        )}
        {/* ... */}
      </Menubar.Menu>
      
      {/* Single dialog container */}
      <DialogProvider api={dialogAPI} />
    </Menubar.Root>
  )
}
```

- **Lines to remove**: 
  - Lines 23-103 (SaveProjectDialog - moved to separate file)
  - Lines 105-144 (ReplaceProjectDialog - moved to separate file)
  - Lines 190-252 (OpenProjectDialog - moved to separate file)
  - Lines 262-274 (deleteProject function - now an operation)
  - Lines 427-543 (All useState hooks and callback functions)
  - Lines 583-630 (onOpenFileSystemFolder - now in operation)
  - All storage type conditionals

- **Net result**: menu.tsx shrinks from ~700 lines to ~150 lines

#### Task 5.2: Create DialogProvider component
**File**: `noodles-editor/src/noodles/components/dialog-provider.tsx` (new)
**Changes**:
- Single component that renders active dialog from menu-store
- Switch statement based on dialog type
- Passes onComplete callback to each dialog

```typescript
function DialogProvider() {
  const activeDialog = useMenuStore(state => state.activeDialog)
  
  if (!activeDialog) return null
  
  switch (activeDialog.type) {
    case 'workspace-picker':
      return <WorkspacePickerDialog {...activeDialog.props} />
    case 'project-name':
      return <ProjectNameDialog {...activeDialog.props} />
    case 'confirm-replace':
      return <ConfirmDialog {...activeDialog.props} />
    case 'confirm-delete':
      return <ConfirmDeleteDialog {...activeDialog.props} />
    // ...
  }
}
```

---

### Phase 6: Update Storage Layer (from previous workspace plan)

#### Task 6.1: Implement workspace-aware storage functions
**File**: `noodles-editor/src/noodles/storage.ts`
**Changes**: (Same as previous plan Phase 2)
- Refactor to workspace-based API
- `save(workspace, projectName, data)`
- `load(workspace, projectName)`
- `listProjects(workspace)`
- `deleteProject(workspace, projectName)` - Add this function
- etc.

#### Task 6.2: Create workspace types and cache
**Files**:
- `noodles-editor/src/noodles/storage/workspace-types.ts`
- `noodles-editor/src/noodles/utils/workspace-cache.ts`
- `noodles-editor/src/noodles/storage/builtin-workspaces.ts`
**Changes**: (Same as previous plan Phase 1)

---

### Phase 7: Integration & Testing

#### Task 7.1: Update noodles.tsx for initial loading
**File**: `noodles-editor/src/noodles/noodles.tsx`
**Changes**:
- On mount, check URL params
- If missing workspace, run `initial-load` operation
- Operation handles workspace selection automatically

```typescript
useEffect(() => {
  const { workspaceName, projectId } = parseURL()
  
  if (!workspaceName && projectId) {
    // Missing workspace, prompt user
    runOperation('initial-load', { projectId })
  } else if (workspaceName && projectId) {
    // Load directly
    runOperation('load-from-url', { workspaceName, projectId })
  } else {
    // Nothing in URL, show workspace picker
    runOperation('initial-load')
  }
}, [])
```

#### Task 7.2: Create operation tests
**Files**: 
- `noodles-editor/src/noodles/operations/new-project.test.ts`
- `noodles-editor/src/noodles/operations/import-project.test.ts`
- `noodles-editor/src/noodles/operations/delete-project.test.ts`
- etc.

**Changes**:
- Test operations with mocked DialogAPI
- Assert dialog requests yielded in correct order
- Assert state updates after completion
- Test cancellation paths
- Much easier to test than callback chains!

**Example test for delete-project**:
```typescript
test('delete-project shows confirmation before deleting', async () => {
  const context = createMockContext({
    workspace: mockWorkspace,
    activeProject: 'my-project'
  })
  
  const generator = deleteProjectOperation(context, 'my-project')
  
  // Expect confirmation dialog
  const { value: dialog } = await generator.next()
  expect(dialog.type).toBe('confirm-delete')
  expect(dialog.projectName).toBe('my-project')
  
  // User confirms
  await generator.next(true)
  
  // Assert delete was called
  expect(context.deleteProject).toHaveBeenCalledWith(
    mockWorkspace, 
    'my-project'
  )
  
  // Assert project cleared from state
  expect(context.setActiveProject).toHaveBeenCalledWith(null)
})

test('delete-project cancels if user says no', async () => {
  const context = createMockContext()
  const generator = deleteProjectOperation(context, 'my-project')
  
  // Show confirmation
  await generator.next()
  
  // User cancels
  const result = await generator.next(false)
  
  // Assert delete NOT called
  expect(context.deleteProject).not.toHaveBeenCalled()
  expect(result.done).toBe(true)
})
```

---

## Benefits of This Architecture

### 1. **Dramatically Simplified menu.tsx**
- From ~700 lines to ~150 lines
- No nested callbacks
- No scattered state management
- No storage type branching

### 2. **Linear, Readable Operation Code**
```typescript
// Before (callback hell):
onMenuSave → maybeSetProjectName → checkProjectExists → 
  setReplaceDialogOpen → onReplaceProject → save → updateCache

// After (linear generator):
async function* saveProject() {
  const workspace = yield ensureWorkspace()
  const name = yield ensureProjectName()
  const confirmed = yield confirmOverwrite()
  await save()
}
```

### 3. **Easy to Test**
- Operations are pure generators
- Mock DialogAPI responses
- Assert dialog sequence
- No complex component mocking

### 4. **Easy to Extend**
Adding workspace support:
- Just add workspace selection to operation flows
- No need to refactor existing callback chains
- Operations automatically get workspace support

### 5. **Type-Safe Dialog Flows**
- TypeScript knows what each dialog yields
- Can't forget to handle dialog result
- Compiler catches missing dialog types

### 6. **Centralized Error Handling**
- Operation runner catches errors
- Single error display logic
- No error handling scattered in callbacks

### 7. **Delete with Safety Guard**
- Delete operation has built-in confirmation
- Can be called from project list dialog or menu
- Consistent "are you sure?" UX everywhere

---

## Migration Strategy

### Phase 1: Parallel Implementation
- Implement new architecture alongside existing code
- New operations in `/operations` folder
- Old menu.tsx unchanged initially

### Phase 2: Gradual Migration
- Migrate one menu item at a time
- Start with "Delete Project" (simple, clear contract)
- Then "New Project"
- Prove architecture works before full migration

### Phase 3: Complete Cutover
- Remove old dialog components from menu.tsx
- Remove callback functions
- Remove state flags
- Clean up

### Phase 4: Add Workspace Support
- Now trivial to add workspace selection to operations
- Just yield workspace dialog at start of each operation

---

## Summary

This architecture solves all identified problems:
- ❌ **Callback hell** → ✅ Linear async generators
- ❌ **Scattered state** → ✅ Centralized Zustand store  
- ❌ **Manual dialog coordination** → ✅ Promise-based dialog API
- ❌ **Storage type branching** → ✅ Workspace abstraction
- ❌ **Hard to test** → ✅ Pure generators, easy mocking
- ❌ **Hard to extend** → ✅ Just add new operations

The refactored menu.tsx will be maintainable, testable, and ready for workspace support. Delete operation provides a good example of the safety guards pattern.