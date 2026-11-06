# Creating and Modifying Noodles.gl Operators

### Basic Structure

```typescript
export class CustomOperator extends Operator<CustomOperator> {
  static displayName = 'Custom Processor'
  static description = 'Processes data with custom logic'

  createInputs() {
    return {
      data: new DataField(),
      threshold: new NumberField(50, { min: 0, max: 100 }),
    }
  }

  createOutputs() {
    return {
      result: new DataField(),
    }
  }

  execute({
    data,
    threshold,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {
      result: data.filter(item => item.value > threshold)
    }
  }
}
```

An operator whose `execute()` reads an API key with `getKeysStore().getKey()` lists those keys in `static usesKeys = ['mapbox'] as const`, so it runs again when the user changes the key.

### Registration (Critical!)

After creating the operator class, you must register it in two places:

**1. Add to `opTypes` object in `operators.ts`** (alphabetically):

```typescript
export const opTypes = {
  // ... other operators ...
  CustomOperator,  // Add your operator here
  // ... more operators ...
} as const
```

**2. Add to appropriate category in `components/categories.ts`**:

```typescript
export const categories = {
  data: [
    'FileOp',
    'DuckDbOp',
    'CustomOperator',  // Add here if it's a data source
    // ...
  ],
  // Or in another category:
  layer: [
    'GeoJsonLayerOp',
    // ...
  ],
  code: [
    'CodeOp',
    // ...
  ],
  // ... other categories
} as const
```

**Available categories:**

- `code` - Code execution and expressions
- `data` - Data sources and transformations
- `color` - Color manipulation
- `geojson` - GeoJSON utilities
- `layer` - Visualization layers
- `extension` - Deck.gl extensions
- `number` - Numeric operations
- `string` - String operations
- `utility` - General utilities
- `vector` - Vector math
- `view` - Camera and viewport
- `widget` - UI widgets
- `grouping` - Container/loop operators

### Key Principles

1. **Pure Functions**: Operators should be deterministic
2. **Typed Inputs/Outputs**: Use Field types with Zod schemas
3. **Reactive**: Changes propagate automatically
4. **Memoized**: Results cached based on input values
5. **Register**: Add to `opTypes` object in `operators.ts` AND to a category in `components/categories.ts`

### Adding a New Operator
1. Create operator class in `operators.ts` or separate file
2. Define inputs with `createInputs()` method
3. Define outputs with `createOutputs()` method
4. Implement `execute()` method with pure function logic
5. **Register operator in `opTypes` object** in `operators.ts` (alphabetically)
6. **Add to appropriate category** in `components/categories.ts` using display name without "Op" suffix (e.g., `'File'` not `'FileOp'`)
7. **Write unit tests** (required for all operators)
8. Run `npm run generate:registry` and `npm run generate:op-docs`, then write Remarks on the new page in `docs/reference/operators/` if the behavior needs explaining
9. Test in UI with example projects

**Important:** Steps 5 and 6 are critical - the operator will not appear in the Add Node menu without these registrations!

### Modifying Existing Operator
1. Locate operator in `operators.ts`
2. Modify inputs, outputs, or execute logic
3. Consider migration if schema changes (see [Adding a Migration](#adding-a-migration))
4. **Update tests** to cover new behavior
5. Add tests for bug fixes to prevent regressions
6. Run `npm run generate:registry` and `npm run generate:op-docs`, and update the page's Remarks in `docs/reference/operators/` if behavior changes
7. Test in UI with example projects

### Adding a Migration
Migrations live in `src/noodles/__migrations__/NNN-kebab-name.ts` with a co-located `.test.ts`; the highest number is the schema version. `npm run generate:migration` scaffolds one.
1. Use the next number after the highest on main, with no gaps or duplicates
2. Put the new basename (no extension) on the single line of `__migrations__/LATEST`. Two open migration PRs both change that line, so the second one gets a merge conflict and must rebase and renumber
3. Bump the example projects to the new version (`npm run migrate-projects`)
4. Regenerate the project JSON Schema (`npm run generate:schema`) and commit the new `website/static/schema/` files. CI runs `npm run generate:schema -- --check`, which fails until you do

`utils/migration-numbering.test.ts` checks the numbering and `LATEST`, and `migrate-schema.ts` throws at load if two migrations share a number.

### Migrating Project Files
`npm run migrate-projects` (from `noodles-editor/`) migrates project files to this checkout's schema version and rewrites only the files that change. With no arguments it covers `src/examples`. Pass any number of files or folders to migrate projects elsewhere; folders are searched for `noodles.json` and other project files, skipping `node_modules` and dot-folders. Relative paths resolve from the directory you ran npm in, and quoted paths with spaces work.

```bash
npm run migrate-projects -- ~/code/my-projects/projects
npm run migrate-projects -- --check ~/code/my-projects/projects
npm run migrate-projects -- --from 19 ~/code/my-projects/projects/"Dubai Hero Route"
```

- `--check` writes nothing, lists each file that would change (`v14 → v23`) and exits 1 if any would, for CI in a projects repo
- `--from <version>` treats one project as saved at that version, when its saved number is wrong. This happens when a file was saved on a branch whose migration was renumbered before merging: a project saved at v20 from that branch never gets main's own 020 until you pass `--from 19`. It needs exactly one project, since the right number is a fact about that file
- A file saved at a version newer than this checkout is reported and left alone; update noodles.gl, or use `--from` if the number came from an unmerged branch

`scripts/migrate-project-files.ts` exports `migrateProjectFiles(paths, { from, write })` for tools that need the same walk and migration.

### Debugging Data Flow
1. Check operator paths are correct (use absolute paths from root)
2. Verify edge connections in project JSON
3. Inspect field values with console logging
4. Check Zod schema validation errors
5. Use execution tracing for performance issues

### Creating Custom Field Type
1. Extend `Field` class in `fields.ts`
2. Implement `createSchema()` method with Zod schema
3. Set default value and options
4. Add custom UI component in `field-components.tsx` if needed
5. Register in field registry
