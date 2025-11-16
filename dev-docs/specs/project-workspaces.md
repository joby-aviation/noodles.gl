# Workspace Architecture Implementation Plan

## Overview
Refactor the storage system to use a unified workspace model where all storage is organized as workspaces containing projects. Add breadcrumb UI showing "workspace / project", improve import flow with project naming, and add workspace naming on open.

## Key Design Decisions
- **Workspace Structure**: Flat - `workspace-folder/project-name/noodles.json + data/`
- **Built-in Workspaces**: Browser Storage (OPFS) and Examples (publicFolder) act as special workspaces
- **Import Flow**: Import saves to current workspace, prompting for project name (prefilled with basename)
- **Workspace Naming**: Always prompt when opening a folder workspace; name becomes the identifier
- **New Project**: Always prompts for workspace selection first if none is active
- **URL Format**: `?workspace=name&project=name`

---

## Phase 1: Core Workspace Data Model

### Task 1.1: Define workspace types and interfaces
**File**: `noodles-editor/src/noodles/storage/workspace-types.ts` (new)
**Changes**:
- Define `WorkspaceType = 'folder' | 'browserStorage' | 'examples'`
- Define simplified `Workspace` interface:
  ```typescript
  interface Workspace {
    type: WorkspaceType
    name: string  // User-visible name (identifier for folder workspaces)
    handle?: FileSystemDirectoryHandle  // Only for 'folder' type
  }
  ```
- Read-only check: `workspace.type === 'examples'`
- Define workspace metadata interfaces for caching
- Define workspace-related error types

### Task 1.2: Create workspace registry and cache
**File**: `noodles-editor/src/noodles/utils/workspace-cache.ts` (new)
**Changes**:
- Extend DirectoryHandleCache for workspaces
- Store workspace entries: `{ name, handle, lastProject, lastAccessed }`
- Functions:
  - `cacheWorkspace(name, handle, lastProject)`
  - `getCachedWorkspace(name)`
  - `listCachedWorkspaces()` - Returns all cached workspaces sorted by lastAccessed
  - `updateLastProject(name, projectName)`
  - `removeWorkspace(name)`
  - `renameWorkspace(oldName, newName)` - For name collision resolution
- Store workspace list in localStorage for quick access

### Task 1.3: Create built-in workspace providers
**File**: `noodles-editor/src/noodles/storage/builtin-workspaces.ts` (new)
**Changes**:
- `getBrowserStorageWorkspace()`: Returns OPFS workspace object
  ```typescript
  { type: 'browserStorage', name: 'Browser Storage' }
  ```
- `getExamplesWorkspace()`: Returns publicFolder workspace object
  ```typescript
  { type: 'examples', name: 'Examples' }
  ```
- `getBuiltinWorkspaces()`: Returns array of both

---

## Phase 2: Refactor Storage Abstraction

### Task 2.1: Add workspace-aware storage functions
**File**: `noodles-editor/src/noodles/storage.ts`
**Changes**:
- Refactor `save()` signature: `save(workspace: Workspace, projectName: string, projectData: NoodlesProjectJSON)`
- Refactor `load()` signature: `load(workspace: Workspace, projectName: string)`
- Add `saveAs(workspace: Workspace, newProjectName: string, projectData: NoodlesProjectJSON)`
- Add `listProjects(workspace: Workspace): Promise<string[]>` - Lists all projects in workspace
- Add `createProject(workspace: Workspace, projectName: string)` - Creates empty project folder
- Add `deleteProject(workspace: Workspace, projectName: string)` - Deletes project from workspace
- Update asset functions:
  - `readAsset(workspace, projectName, fileName)`
  - `writeAsset(workspace, projectName, fileName, contents)`
- Remove old `type` parameter from all functions
- Check `workspace.type === 'examples'` for read-only enforcement

### Task 2.2: Implement workspace project listing
**File**: `noodles-editor/src/noodles/storage.ts`
**Changes**:
- For `folder` type: Scan directory for subdirectories containing `noodles.json`
- For `browserStorage`: List OPFS project directories
- For `examples`: Scan `/public/noodles/` directories (or use manifest)
- Return sorted array of project names

---

## Phase 3: State Management

### Task 3.1: Update filesystem store for workspaces
**File**: `noodles-editor/src/noodles/filesystem-store.tsx`
**Changes**:
- **Replace** `activeStorageType` → `currentWorkspace: Workspace | null`
- **Replace** `currentProjectName` → `activeProject: string | null`
- **Replace** `currentDirectory` → remove (handle is in workspace object)
- **Add** `projectsInWorkspace: string[]`
- **Add** `recentWorkspaces: Workspace[]` (loaded from cache)
- Update actions:
  - `setCurrentWorkspace(workspace, projects)`
  - `setActiveProject(projectName)`
  - `setProjectsInWorkspace(projects)`
  - `loadRecentWorkspaces()` - Load from cache
- Update selectors:
  - `useCurrentWorkspace()`
  - `useActiveProject()`
  - `useProjectsInWorkspace()`
  - `useRecentWorkspaces()`
- Remove `activeStorageType`, `currentDirectory` and related code

### Task 3.2: Update URL parameter handling
**File**: `noodles-editor/src/noodles/globals.ts`
**Changes**:
- Add `workspaceName` parsing: `queryParams.get('workspace')`
- Export both `workspaceName` and `projectId`
- Keep backward compatibility: if only `?project=` exists, workspace is undefined

---

## Phase 4: UI Components

### Task 4.1: Create workspace naming dialog
**File**: `noodles-editor/src/noodles/components/workspace-name-dialog.tsx` (new)
**Changes**:
- Dialog prompting for workspace name when opening folder
- Input field prefilled with folder name (from `handle.name`)
- Validation: 3-32 chars, no special characters
- Check for name collisions, show error if exists
- Buttons: "Cancel", "Open Workspace"
- Returns workspace name or null if cancelled

### Task 4.2: Create workspace picker dialog
**File**: `noodles-editor/src/noodles/components/workspace-picker-dialog.tsx` (new)
**Changes**:
- Shows all available workspaces:
  - Built-in: Browser Storage, Examples (always at top)
  - Recent folder workspaces (sorted by last accessed)
- Each workspace shows:
  - Icon (📦 Browser, 📚 Examples, 📁 Folder)
  - Name
  - Folder name (for folder type, from `handle.name`, shown in smaller text)
  - Last accessed time
- Buttons at bottom:
  - "Browse for Folder..." (shows native folder picker + naming dialog)
  - "Cancel"
- Returns selected Workspace or null

### Task 4.3: Create project list dialog
**File**: `noodles-editor/src/noodles/components/project-list-dialog.tsx` (new)
**Changes**:
- Shows all projects in current workspace
- Table with columns: Name, Last Modified
- Actions per project:
  - Click row to select/open
  - Delete button (trash icon) - disabled for Examples workspace
- Header shows current workspace name
- Buttons:
  - "New Project..." (disabled for Examples workspace)
  - "Cancel"
  - "Open" (opens selected project)
- Returns project name or special action ('new', 'cancel')

### Task 4.4: Update SaveProjectDialog for import flow
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Add `defaultName` prop to SaveProjectDialog
- When importing, extract basename from file path
- Strip `.noodles.json` or `.json` extension
- Prefill project name input with basename
- Keep existing validation and replace confirmation flow

### Task 4.5: Create workspace/project breadcrumb UI
**File**: `noodles-editor/src/noodles/components/workspace-project-bar.tsx` (new, replaces ProjectNameBar)
**Changes**:
- Display format: `[workspace-icon] workspace-name / project-name`
- Examples:
  - `📦 Browser Storage / my-project`
  - `📁 My Work / demo-viz`
  - `📚 Examples / airports`
- Make workspace name clickable → opens workspace picker
- Make project name clickable → opens project list dialog (current workspace)
- Show "Untitled" for project if no name
- Show "No workspace" if no workspace (shouldn't happen after refactor)
- Replace existing ProjectNameBar usage in main layout

---

## Phase 5: Menu Integration

### Task 5.1: Update "New Project" operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Check if workspace is active
- If no workspace: Show workspace picker first
- If workspace.type === 'examples': Show error
- Show SaveProjectDialog (no default name)
- Create blank project from template
- Call `save(workspace, projectName, newProjectData)`
- Update URL with workspace and project
- Update recent workspaces

### Task 5.2: Update "Import" operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Check if workspace is active
- If no workspace: Show workspace picker first
- If workspace.type === 'examples': Show error
- Show file picker for `.json` files
- Extract basename from file path (remove `.noodles.json` or `.json` extension)
- Show SaveProjectDialog with defaultName = basename
- Migrate and validate imported project
- Call `save(workspace, projectName, importedData)`
- Update URL and recent workspaces

### Task 5.3: Update "Open..." operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Show workspace picker dialog
- If user selects folder workspace:
  - Show workspace naming dialog
  - Cache workspace with name
  - Load projects list
  - Show project list dialog
  - Load selected project
- If user selects built-in workspace:
  - Load projects list
  - Show project list dialog
  - Load selected project
- Update URL with workspace and project
- Update recent workspaces

### Task 5.4: Add "Switch Project..." operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- New menu item: "Switch Project..." (⌘⇧O)
- Only enabled if workspace is active
- Shows project list dialog for current workspace
- Loads selected project
- Updates URL project parameter
- Updates recent workspaces with new last project

### Task 5.5: Add "Switch Workspace..." operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- New menu item: "Switch Workspace..." (⌘⇧W)
- Shows workspace picker dialog
- Follows same flow as "Open..." but for workspace switching
- Prompts to save current project if unsaved changes exist

### Task 5.6: Update "Save" operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Check if workspace and project name exist
- If no workspace: Prompt for workspace (workspace picker)
- If no project name: Show SaveProjectDialog
- If workspace.type === 'examples': Show error
- Call `save(workspace, projectName, projectData)`
- Update URL and recent workspaces
- Keep existing replace confirmation flow

### Task 5.7: Add "Save As..." operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- New menu item: "Save As..." (⌘⇧S)
- Check if workspace exists
- If no workspace: Prompt for workspace
- If workspace.type === 'examples': Show error
- Show SaveProjectDialog with empty/new name
- Call `saveAs(workspace, newProjectName, projectData)`
- Update URL and recent workspaces

### Task 5.8: Update "Download Project" operation
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Keep existing ZIP export logic
- Update to work with workspace context
- Use workspace + project to get directory handle
- Export as `{projectName}.zip` (unchanged)

### Task 5.9: Update "Open Recent" submenu
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Change from recent projects to recent workspaces
- Show: `workspace-name / last-project-name`
- Clicking loads that workspace and project
- Store in localStorage: `{workspaceName, lastProject, lastAccessed}`
- Max 6 recent workspaces

### Task 5.10: Remove deprecated storage-type-specific code
**File**: `noodles-editor/src/noodles/components/menu.tsx`
**Changes**:
- Remove `checkProjectExists()` function (lines ~254-260)
- Remove `deleteProject()` function (lines ~262-274)
- Remove `getProjectHandle()` function (lines ~276-288)
- Remove `listProjects()` function (lines ~343-365)
- Remove storage type conditionals throughout menu operations
- All these operations now use workspace abstraction

---

## Phase 6: Application Integration

### Task 6.1: Update initial project loading
**File**: `noodles-editor/src/noodles/noodles.tsx`
**Changes**:
- Parse `workspaceName` and `projectId` from URL
- **Loading flow**:
  1. If both workspace and project in URL: Load from that workspace
  2. If only project in URL (legacy): Try Examples → Browser Storage (backward compat)
  3. If neither: Check for cached last workspace/project
  4. If nothing: Show workspace picker automatically
- Load builtin workspaces into store on mount
- Update URL when workspace/project loads
- Handle ProjectNotFoundDialog in workspace context

### Task 6.2: Update ProjectNotFoundDialog for workspaces
**File**: `noodles-editor/src/noodles/components/project-not-found-dialog.tsx`
**Changes**:
- Update "Locate Project Folder" → "Locate Workspace Folder"
- Show workspace naming dialog after folder selection
- Search for project in selected workspace
- Update error messages to be workspace-aware

### Task 6.3: Update FileOp for workspace-aware asset loading
**File**: `noodles-editor/src/noodles/operators.ts` (FileOp)
**Changes**:
- Get current workspace from store (useCurrentWorkspace)
- Get current project from store (useActiveProject)
- Call `readAsset(workspace, projectName, fileName)`
- Handle case where no workspace is active (show error)

### Task 6.4: Update FileFieldComponent for workspace-aware uploads
**File**: `noodles-editor/src/noodles/components/field-components.tsx`
**Changes**:
- Get current workspace and project from store
- Call `writeAsset(workspace, projectName, fileName, contents)`
- Show error for Examples workspace (read-only)
- Handle case where no workspace is active

---

## Phase 7: Testing & Cleanup

### Task 7.1: Update storage tests
**File**: `noodles-editor/src/noodles/storage.test.ts`
**Changes**:
- Refactor all tests to use Workspace objects instead of storage types
- Test folder, browserStorage, and examples workspaces
- Test project listing in workspaces
- Test save/load/saveAs with workspace context
- Test asset read/write with workspaces
- Test read-only enforcement for Examples

### Task 7.2: Add workspace-specific tests
**File**: `noodles-editor/src/noodles/storage/workspace.test.ts` (new)
**Changes**:
- Test workspace caching and retrieval
- Test workspace naming and collision detection
- Test project listing across workspace types
- Test builtin workspace providers
- Test recent workspaces tracking

### Task 7.3: Add UI component tests
**Files**: 
- `workspace-name-dialog.test.tsx`
- `workspace-picker-dialog.test.tsx`
- `project-list-dialog.test.tsx`
- `workspace-project-bar.test.tsx`
**Changes**:
- Test dialog interactions and validation
- Test workspace/project selection flows
- Test breadcrumb clickability and navigation

### Task 7.4: Update documentation
**Files**: 
- `AGENTS.md`
- `dev-docs/architecture.md`
- User documentation
**Changes**:
- Document workspace architecture and concepts
- Update storage system documentation
- Add workspace workflow examples
- Document URL parameter format
- Update file operations documentation

---

## Migration Strategy

### Backward Compatibility
- **URL**: `?project=name` still works (tries Examples → Browser Storage)
- **Cached Handles**: Existing fileSystemAccess project handles can be migrated to workspace structure
- **OPFS Projects**: Existing OPFS projects automatically appear in Browser Storage workspace
- **Public Folder**: Existing examples work unchanged in Examples workspace

### Migration Path
1. Users continue using single projects as before
2. Users can adopt workspace model by using "Open Workspace..."
3. Import flow guides users to workspace model
4. No data migration required - everything remains accessible

---

## Manual Testing Plan

### Test Scenarios
1. **Open folder workspace** → Name it → See projects → Open project
2. **Create new project** → Select workspace → Name project → Save
3. **Import JSON** → Select workspace → See prefilled name (basename) → Save
4. **Switch project** → See list → Select different project
5. **Switch workspace** → See recent + browse → Select workspace → See projects
6. **Save As** → Enter new name → Verify new project in workspace
7. **Breadcrumb clicks** → Click workspace name → See picker
8. **Breadcrumb clicks** → Click project name → See project list
9. **URL with workspace** → `?workspace=foo&project=bar` → Loads correctly
10. **Legacy URL** → `?project=example` → Loads from Examples
11. **Built-in workspaces** → Browser Storage and Examples always available
12. **Read-only workspace** → Examples blocks save/new/import operations
13. **Recent workspaces** → Shows last 6 with last project
14. **Asset loading** → FileOp reads from workspace/project/data/
15. **Asset upload** → FileFieldComponent writes to workspace/project/data/

---

## Summary

This refactoring transforms the storage system into a workspace-centric architecture with a simplified `Workspace` interface (no `isReadOnly` or `path` fields). Read-only checks use `workspace.type === 'examples'` and path info comes from `handle.name`. The implementation maintains complete backward compatibility while providing an intuitive breadcrumb UI, improved import flow, and unified workspace management.
