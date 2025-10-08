# Requirements Document

## Introduction

This feature implements fully qualified paths for operators and input/output handles to support nested containers and eliminate global ID collisions. Currently, operators use simple string IDs like `'code'` which can cause conflicts when multiple containers have operators with the same base name. The new system will use Unix-style paths like `/code1` or `/sub-component/code1` to uniquely identify operators across the entire project hierarchy.

## Requirements

### Requirement 1

**User Story:** As a developer working with nested containers, I want operators to have unique fully qualified paths, so that I can avoid ID collisions between operators in different containers.

#### Acceptance Criteria

1. WHEN an operator is created within a container THEN its ID SHALL be the fully qualified path from the root (e.g., `/sub-component/code1`)
2. WHEN an operator is created at the root level THEN its ID SHALL start with `/` (e.g., `/code1`)
3. WHEN multiple containers exist THEN operators with the same base name SHALL be allowed as long as they have different fully qualified paths (e.g., `/container1/code1` and `/container2/code1`)
4. WHEN displaying operator names in the UI THEN only the base name SHALL be shown in the NodeHeader component (e.g., `code1` instead of `/container1/code1`)

### Requirement 2

**User Story:** As a developer connecting operators, I want to reference handles by their fully qualified paths, so that connections are unambiguous across container boundaries.

#### Acceptance Criteria

1. WHEN connecting operators via React Flow handles THEN the handle IDs SHALL use fully qualified paths (e.g., `/sub-component/code1.par.data`)
2. WHEN creating connections between operators THEN the system SHALL resolve the correct source and target handles using fully qualified paths
3. WHEN an operator references another operator's handle THEN the reference SHALL use the fully qualified path format
4. WHEN saving project files THEN all handle references SHALL be stored using fully qualified paths

### Requirement 3

**User Story:** As a developer writing operator code in a CodeField, I want to use relative path resolution with the `op()` function, so that I can reference other operators using familiar Unix-style path syntax.

#### Acceptance Criteria

1. WHEN calling `op('/sub-component/code1')` THEN the system SHALL resolve to the operator at the absolute path from the root
2. WHEN calling `op('./code1')` THEN the system SHALL resolve to an operator in the same container as the calling operator
3. WHEN calling `op('../code1')` THEN the system SHALL resolve to an operator in the parent container of the calling operator
4. WHEN calling `op('code1')` without path prefix THEN the system SHALL resolve to an operator in the same container (equivalent to `./code1`)
5. WHEN a path cannot be resolved THEN the function SHALL return undefined (maintaining current behavior)

### Requirement 4

**User Story:** As a user with existing project files, I want my saved projects to continue working after the path system is implemented, so that I don't lose my work.

#### Acceptance Criteria

1. WHEN loading a project file with old-format operator IDs THEN the system SHALL automatically migrate them to fully qualified paths using the migration system in __migrations__
2. WHEN migration occurs THEN simple IDs SHALL be converted to root-level paths (e.g., `code1` becomes `/code1`)
3. WHEN migration occurs THEN all handle references SHALL be updated to use fully qualified paths
4. WHEN migration occurs THEN the migrated project SHALL function identically to the original
5. WHEN migration is complete THEN the project file SHALL be permanently updated to the new format

### Requirement 5

**User Story:** As a developer, I want the opMap to store operators by their fully qualified paths, so that operator lookup is consistent throughout the system.

#### Acceptance Criteria

1. WHEN an operator is created THEN it SHALL be stored in opMap using its fully qualified path as the key
2. WHEN looking up an operator THEN the system SHALL use the fully qualified path for retrieval
3. WHEN an operator is moved between containers THEN its opMap entry SHALL be updated with the new fully qualified path
4. WHEN an operator is deleted THEN its opMap entry SHALL be removed using the fully qualified path
5. WHEN an operator is renamed THEN its opMap entry SHALL be updated with the new fully qualified path

### Requirement 6

**User Story:** As a developer, I want comprehensive tests for path resolution, so that I can be confident the system works correctly across all scenarios.

#### Acceptance Criteria

1. WHEN testing absolute path resolution THEN tests SHALL verify correct operator lookup for paths starting with `/`
2. WHEN testing relative path resolution THEN tests SHALL verify correct resolution for `./` and `../` prefixes
3. WHEN testing invalid paths THEN tests SHALL verify that undefined is returned
4. WHEN testing nested container scenarios THEN tests SHALL verify correct path resolution across multiple container levels
5. WHEN testing migration THEN tests SHALL verify that old format files are correctly converted to new format
