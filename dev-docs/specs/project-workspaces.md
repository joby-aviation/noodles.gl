# Unified Workspace Architecture Refactoring

## Vision
Refactor storage to use a **unified workspace model** where all storage types are workspaces:
- **File System Workspaces**: User-selected folders (many possible)
- **Browser Storage**: Single OPFS workspace (appears as "📦 Browser Storage")
- **Examples**: Read-only public folder workspace (appears as "📚 Examples")

All workspaces contain projects with identical structure: `project-name/noodles.json + data/`

---

## Core Concepts

### Workspace Types
```typescript
type WorkspaceType = 'fileSystem' | 'browserStorage' | 'examples'

interface Workspace {
  type: WorkspaceType
  id: string  // path for fileSystem, 'browser-storage' or 'examples'
  displayName: string
  handle?: FileSystemDirectoryHandle
  isReadOnly: boolean
}
```

### Workspace Structure
```
workspace-root/
├── project-1/
│   ├── noodles.json
│   └── data/
├── project-2/
│   ├── noodles.json
│   └── data/
```

---

## Implementation Tasks

### Phase 1: Core Architecture Changes

**Task 1: Introduce Workspace abstraction**
- File: `noodles-editor/src/noodles/storage/workspace.ts` (new)
- Define `Workspace`, `WorkspaceType`, `WorkspaceInfo` interfaces
- Create `WorkspaceRegistry` to track active workspace
- Functions:
  - `createWorkspace(type, id, handle?): Workspace`
  - `getWorkspaceDisplayName(workspace): string`
  - `listProjectsInWorkspace(workspace): Promise<string[]>`
  - `getProjectDirectory(workspace, projectName): Promise<FileSystemDirectoryHandle>`

**Task 2: Refactor storage abstraction to be workspace-centric**
- File: `noodles-editor/src/noodles/storage.ts`
- **Replace**: `save(type, projectName, data)` → `save(workspace, projectName, data)`
- **Replace**: `load(type, projectName)` → `load(workspace, projectName)`
- Add: `saveAs(workspace, newProjectName, data)` for "Save As"
- Add: `createProject(workspace, projectName)` for new projects
- Remove storage type switching - workspace determines implementation

**Task 3: Update filesystem utilities for workspace operations**
- File: `noodles-editor/src/noodles/utils/filesystem.ts`
- Add `listProjectFolders(workspaceHandle): Promise<string[]>`
- Add `isValidProjectFolder(dirHandle): Promise<boolean>` (checks for noodles.json)
- Update OPFS functions to use workspace structure: `getOPFSWorkspaceRoot()`

### Phase 2: State Management

**Task 4: Refactor filesystem store to workspace model**
- File: `noodles-editor/src/noodles/filesystem-store.tsx`
- **Replace**: `activeStorageType` → `currentWorkspace: Workspace | null`
- **Replace**: `currentProjectName` → `activeProject: string | null`
- Add: `availableWorkspaces: Workspace[]` (cached/favorite workspaces)
- Add: `projectsInWorkspace: string[]`
- Actions:
  - `setCurrentWorkspace(workspace)`
  - `setActiveProject(projectName)`
  - `setProjectsInWorkspace(projects)`
  - `addWorkspaceToRecent(workspace)`
- Selectors:
  - `useCurrentWorkspace()`
  - `useActiveProject()`
  - `useProjectsInWorkspace()`

**Task 5: Create workspace cache service**
- File: `noodles-editor/src/noodles/utils/workspace-cache.ts` (new)
- Extend DirectoryHandleCache for workspaces:
  - `cacheWorkspace(workspaceId, handle, metadata)`
  - `getCachedWorkspace(workspaceId)`
  - `updateWorkspaceMetadata(workspaceId, { lastProject, lastAccessed })`
  - `listCachedWorkspaces()`
- Store recent workspaces in localStorage (for display order)

### Phase 3: Built-in Workspaces

**Task 6: Implement Browser Storage workspace (OPFS)**
- File: `noodles-editor/src/noodles/storage/browser-storage-workspace.ts` (new)
- Structure: OPFS root with project folders directly
- Functions:
  - `getBrowserStorageWorkspace(): Workspace`
  - `listBrowserStorageProjects(): Promise<string[]>`
  - `getBrowserStorageProjectDir(projectName): Promise<FileSystemDirectoryHandle>`
- Always available (no caching/permissions needed)

**Task 7: Implement Examples workspace (publicFolder)**
- File: `noodles-editor/src/noodles/storage/examples-workspace.ts` (new)
- Structure: `/public/noodles/` as workspace root
- Functions:
  - `getExamplesWorkspace(): Workspace`
  - `listExampleProjects(): Promise<string[]>`
  - `loadExampleProject(projectName): Promise<NoodlesProjectJSON>`
- Read-only, uses fetch API
- Scan directory or use manifest file

### Phase 4: UI Components

**Task 8: Create unified workspace picker**
- File: `noodles-editor/src/noodles/components/workspace-picker.tsx` (new)
- Shows all available workspaces in one list:
  - 📦 Browser Storage (always present)
  - 📚 Examples (always present)
  - Recent file system workspaces with paths
  - ➕ "Browse for Workspace Folder" button
- Returns selected `Workspace` object

**Task 9: Create project switcher component**
- File: `noodles-editor/src/noodles/components/project-switcher.tsx` (new)
- Lists projects in current workspace
- Shows "➕ New Project" button (disabled for read-only)
- Displays current project with checkmark
- Allows switching to different project

**Task 10: Create workspace toolbar indicator**
- File: `noodles-editor/src/noodles/components/workspace-toolbar.tsx` (new)
- Shows: `[workspace-icon] workspace-name / project-name`
- Clickable workspace name → opens workspace picker
- Clickable project name → opens project switcher
- Example: `📦 Browser Storage / my-project` or `📁 /Users/me/work / demo`

**Task 11: Create "Save As" dialog**
- File: `noodles-editor/src/noodles/components/save-as-dialog.tsx` (new)
- Prompts for new project name
- Validates name (no existing project, valid characters)
- Saves to current workspace with new name

### Phase 5: Menu Integration

**Task 12: Refactor menu for workspace model**
- File: `noodles-editor/src/noodles/components/menu.tsx`
- **Update File menu structure**:
  - New Project (creates in current workspace, prompts for workspace if none)
  - Open Workspace... (shows workspace picker)
  - Open Project... (shows project switcher for current workspace)
  - Save (saves to current workspace/project)
  - Save As... (new - saves with different name in current workspace)
  - Export as ZIP (unchanged)
  - Import from JSON (unchanged)
- **Remove**: Legacy OPFS-specific functions
- **Remove**: Storage type switching (workspace handles this)
- **Update**: Recent items show workspace + project

**Task 13: Update menu state management**
- File: `noodles-editor/src/noodles/components/menu.tsx`
- Replace storage type checks with workspace type checks
- Use workspace from store instead of activeStorageType
- Handle read-only workspaces (disable Save, Save As, New)
- Update dialogs to be workspace-aware

### Phase 6: Application Integration

**Task 14: Update main Noodles component for workspace loading**
- File: `noodles-editor/src/noodles/noodles.tsx`
- **Update URL params**: Support `?workspace=id&project=name`
- **Initial load logic**:
  1. Check URL for workspace ID and project name
  2. If no URL params: Try loading last workspace/project from cache
  3. If workspace cached: Restore workspace and project
  4. If no workspace: Prompt user to select workspace
- **Fallback compatibility**: `?project=name` tries Examples → Browser Storage

**Task 15: Update asset loading (FileOp)**
- File: `noodles-editor/src/noodles/operators.ts` (FileOp)
- Access current workspace from store
- Use `readAsset(workspace, projectName, fileName)` from storage
- Remove `@/` prefix handling (already in storage abstraction)

**Task 16: Update asset uploading (FileFieldComponent)**
- File: `noodles-editor/src/noodles/components/field-components.tsx`
- Access current workspace from store
- Use `writeAsset(workspace, projectName, fileName, contents)` from storage
- Show error for read-only workspaces

### Phase 7: Testing & Cleanup

**Task 17: Update storage tests**
- File: `noodles-editor/src/noodles/storage.test.ts`
- Refactor tests to use workspace objects instead of storage types
- Test all three workspace types
- Test project switching within workspace
- Test "Save As" functionality

**Task 18: Add workspace-specific tests**
- File: `noodles-editor/src/noodles/storage/workspace.test.ts` (new)
- Test workspace creation and metadata
- Test project listing across workspace types
- Test workspace caching and restoration

**Task 19: Remove deprecated code**
- Remove old OPFS functions from menu.tsx (lines 254-365)
- Remove `activeStorageType` concept throughout codebase
- Remove `StorageType` type (replaced by `WorkspaceType`)
- Clean up any storage-type-specific conditionals

**Task 20: Update documentation**
- Update AGENTS.md with workspace concepts
- Document workspace structure and types
- Update user documentation for workspace workflow
- Add workspace examples to dev-docs

---

## Migration Strategy

- **Zero migration needed**: OPFS isn't used by users yet
- **Backward compatibility**: URL `?project=name` tries Examples, then Browser Storage
- **Smooth transition**: Existing fileSystemAccess cached handles become cached workspaces
- **No breaking changes**: Existing project files work as-is

---

## Key Benefits

1. **Unified mental model**: Everything is a workspace
2. **Consistent UI**: Same workflow for all storage types
3. **Simpler code**: No storage type switching logic
4. **Better UX**: Clear workspace/project hierarchy
5. **Extensible**: Easy to add cloud workspaces later

---

## Testing Plan

- **Unit tests**: Workspace abstraction, project listing, save/load
- **Integration tests**: Workspace switching, project creation, Save As
- **Manual testing**: 
  - Open Browser Storage → Create project → Save → Switch project
  - Open file system workspace → Switch project → Save As
  - Load Examples workspace → View projects (read-only)
  - URL with workspace/project params