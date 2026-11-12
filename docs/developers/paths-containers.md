# Paths and Subnets

Nodes are grouped into subnets, and a node is named by its path through them, the way Houdini names nodes. Paths are what references, expressions and the editor's tools use. The functions on this page are in `packages/planner/src/doc.ts`.

## Names and paths

A node's `id` is opaque and never changes. Its `name` is unique within its network (the root, or one subnet), and its path is its name under its subnets' names:

```
/                          (root)
├── quakes                 /quakes
├── threshold              /threshold
└── analysis               /analysis (a subnet)
    ├── filter1            /analysis/filter1
    └── styling            /analysis/styling (a nested subnet)
        └── points         /analysis/styling/points
```

The same name can appear in different subnets. A node added in the editor gets a name like `filter1` or `filter2` (`uniqueName` in `noodles-editor/src/editor/doc-ops.ts`). `nodePath(doc, node)` returns a node's path, and tools accept an id, a name or a path.

## Parameter references

A `{ "ref": "..." }` parameter and `ch('...')` in an expression name another parameter by path, resolved from the node that holds it (`resolveRef`):

| Reference | Resolves to |
|-----------|-------------|
| `size` | parameter `size` on the same node |
| `controls/size` | `size` on sibling `controls` |
| `../controls/size` | `size` on `controls` in the enclosing network |
| `/analysis/controls/size` | absolute, from the root |

```json
{ "radiusScale": { "expr": "ch('../controls/size') * 2 + sin(T)" } }
```

Renaming a node or collapsing it into a subnet rewrites the references to it (`rebaseReferences` in `doc-ops.ts`), so they keep pointing at the same parameter.

## Subnets

A `subnet` node holds a network: its children are the nodes whose `parent` is the subnet's id.

- **Inputs**: the subnet's `in0` and `in1` ports feed the `subnet-input` node inside whose `index` is 0 or 1.
- **Output**: whatever is wired into the `subnet-output` node inside is the subnet's `out0`.
- **Promoted parameters**: a subnet's `promoted` list exposes a child's parameter on the subnet, which then drives it.

Before compiling, `flattenSubnets` removes subnets and rewires each edge that crosses a boundary to its real endpoint. Children keep their ids, so collapsing a selection into a subnet (Shift+C in the network editor) changes nothing the planner sees. In the editor, Enter goes into the selected subnet and U goes back up.

## Loops

The older ForLoop operators have no equivalent, and a project that uses one cannot be converted. Per-item work is a row operation over a table: an attribute, a `sql` node or a `code` node.
