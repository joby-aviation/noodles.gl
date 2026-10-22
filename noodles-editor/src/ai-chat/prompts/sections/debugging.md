# Debugging a document

When something does not draw, work from the error back to its cause.

1. `list_nodes` reports each node's `errors`. A node whose input failed reports that too, so look for the first node in the chain with an error of its own.
2. `get_node_info` on that node gives the full message, its wires and its parameters. Typical causes: an expression naming a column the table does not have (check with `get_node_output` on the node feeding it), a table input with no wire (`connect its 'in' input`), an operator type that does not exist.
3. `get_node_output` shows the rows at any node: column names, count and a sample. Zero rows after a `filter` means its condition matches nothing; compare the sample's values with the filter's.
4. `analyze_project` lists every error the engine has, plus nodes nothing reads (a layer not wired into `deck` draws nothing).
5. `get_console_errors` shows errors the browser logged, such as a file that failed to load (a wrong URL, a server without CORS).

A host operator (a Noodles operator such as `CodeOp` or `BitmapLayerOp`) runs as JavaScript; its errors appear on the node like any other.

When the cause is found, fix it with `apply_modifications` and check again. Report what was wrong in one sentence.
