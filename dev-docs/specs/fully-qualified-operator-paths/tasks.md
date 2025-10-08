# Implementation Plan

- [x] 1. Create path resolution utilities
  - Implement core path resolution functions for absolute and relative paths
  - Add path normalization and validation logic
  - Create utility functions for path manipulation (getParentPath, getBaseName, etc.)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 2. Update operator ID generation system
  - Modify nodeId function to generate fully qualified paths based on container context
  - Update OpId type to reflect new path format
  - Ensure root-level operators get `/` prefix
  - _Requirements: 1.1, 1.2_

- [x] 3. Enhance getOp function with path resolution
  - Add optional contextOperatorId parameter to getOp function
  - Implement path resolution logic within getOp
  - Support absolute paths, relative paths (./), parent paths (../), and same-container references
  - Maintain backward compatibility by returning undefined for unresolvable paths
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Update operator constructor and opMap integration
  - Modify Operator constructor to accept and store fully qualified paths
  - Update opMap.set calls throughout the codebase to use qualified paths
  - Ensure containerId is properly used in path construction
  - _Requirements: 1.1, 1.2, 5.1, 5.2_

- [x] 5. Update handle ID system for React Flow
  - Modify Handle component invocations to use fully qualified paths
  - Update handle ID generation to include operator's full path
  - Ensure handle IDs follow format: `/operator/path.namespace.fieldName`
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 6. Update edge connection system
  - Modify transform-graph.ts to work with qualified paths
  - Update edge creation and connection logic to use qualified handle IDs
  - Ensure sourceHandle and targetHandle use fully qualified format
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 7. Update field pathToProps system
  - Modify field pathToProps to use fully qualified operator paths
  - Update mustache regex and field reference resolution
  - Ensure CodeOp, JSONOp, and DuckDbOp work with qualified paths
  - _Requirements: 2.3, 2.4_

- [x] 8. Update NodeHeader display logic
  - Modify NodeHeader component to display only base name (not full path)
  - Add utility function to extract display name from qualified path
  - Ensure operator editing still works with qualified paths
  - _Requirements: 1.4_

- [x] 9. Add migration function to migrate-schema.ts
  - Create migration function to detect old-format projects
  - Implement conversion from simple IDs to qualified paths
  - Update all edge references to use qualified paths
  - Handle container hierarchy reconstruction during migration
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 10. Update container operations
  - Modify ContainerOp to work with qualified paths
  - Update container-to-child operator path propagation
  - Ensure nested containers create proper path hierarchies
  - _Requirements: 1.1, 1.3, 5.3_

- [x] 11. Write comprehensive unit tests
  - Test path resolution functions with various scenarios
  - Test getOp function with absolute and relative paths
  - Test handle ID generation and parsing
  - Test edge cases and error conditions
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 12. Write integration tests
  - Test end-to-end operator creation and connection with qualified paths
  - Test migration of old-format project files
  - Test nested container scenarios
  - Test React Flow integration with qualified handle IDs
  - _Requirements: 6.5_

- [x] 13. Update existing operator references
  - Search and update any hardcoded operator ID references
  - Update test files to use qualified paths
  - Ensure all operator lookups use the enhanced getOp function
  - _Requirements: 5.4_

- [ ] 14. Performance optimization and validation
  - Add performance tests for path resolution with deep nesting
  - Validate memory usage with large numbers of operators
  - Optimize path resolution caching if needed
  - Add validation for path format consistency
  - _Requirements: All requirements validation_

- [x] 15. Cleanup and refactoring
  - Clean up duplicate code and extraneous tests
  - Ensure that all code is properly refactored and optimized
  - Ensure that all tests are comprehensive and maintainable, and cover edge cases
  - Ensure that there are not too many tests that are not needed
  - _Requirements: All requirements validation_

- [x] 16. Documentation and user guides
  - Update documentation to reflect new path format
  - Create user guides for operators and container hierarchy
  - Keep documentation terse and maximally helpful
  - _Requirements: 1.5, 1.6, 1.7_
