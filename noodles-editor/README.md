# Noodles.gl

This tool is a node-based UI aimed at creating geospatial visuals in Deck.gl. It aims to strike a balance between flexibility and fast iterations with an emphasis on reactive data.

![Noodles.gl](../../website/static/img/noodles.png)

Think about it like Kepler.gl-meets-Blender Geometry Nodes-meets-Observable.

# Architecture

The main concepts to understand are Operators and Fields.

Put simply, Operators are a collection of Fields, with an `execute` method. This method is preferably a pure function of input state => derived output. Things like math, fetching directions, or Deck.gl layers.

Noodles.gl follows flow-based programming. Outputs from one node flow to inputs from another via connections. We use rxjs to manage dataflow. When an upstream node's data changes its downstream nodes will re-run, and so on until they output to draw to the screen via Deck.gl.

We also support keyframing values (and a timeline UI) via Theatre.js. The Noodles.gl UI is rendered by React Flow. We try to use functional reactive programming everywhere in the app to limit the number of sources of truth for these various libraries. Most times the `Operator` instance is the source of truth.

## Fields

**Fields are both a validator of data schema and a hint to the UI on what data to render**. Number fields may have a minimum and a maximum value. Geocoder operators need to render a purpose-built UI.

This is especially important for the various object schemas - some data sources are a strict object of specific keys, others allow for more advanced data processing. We try to hint in the UI via CompoundPropsFields for specific types and DataFields for more open-ended types.

Fields can be connected so that the output of one field flows into the input of another. This is how we create dataflow.

## Operators

Operators pull in data from inputs and process the streams via `execute` when any of them change.

Some operators support custom javascript code. Those are AccessorOp, ExpressionOp, and CodeOp. The first input to the `data` handle (or the callback value in the case of AccessorOp) is typically passed as `d`, and the array of inputs is `data`. You can reactively reference other operators with the `op` function using fully qualified paths: `op('/config/num').par.val` or relative paths: `op('./num').par.val` will automatically set up a reference. A few other convenience utils are provided: `d3`, `turf`, `deck`, `Plot` and all of the Operators are exposed (`const n = new NumberOp(); const val = n.execute({ a: 5, b: 10 })`).

JSONOp and DuckDbOp are two other open-ended operators, which support JSON and DuckDB SQL, respectively. DuckDB is especially powerful because it can reference external APIs and do many advanced data processing tasks. Combined with reactive references (via mustache syntax - `{{/geocoder.out.location}}` or `{{./geocoder.out.location}}`) it is very easy to create quick data apps.

## Operator Paths and Organization

Operators are identified by Unix-style paths that reflect their container hierarchy:
- Root operators: `/operator-name`
- Nested operators: `/container/operator-name`
- Deep nesting: `/container/subcontainer/operator-name`

See [docs/paths-and-containers.md](docs/paths-and-containers.md) for detailed information.

## CodeOps

CodeOps are a special type of Operator that allows you to write custom javascript code. They are useful for *complex* data processing tasks that are not supported by the other Operators.

If you reference another operator and its field with the `op('num').par.val` syntax, it will automatically set up a reference that will re-run the CodeOp when the `num` op updates.

## AccessorOps

AccessorOps are a special type of Operator that allows you to access data as a callback. They are typically used with Deck.gl layers. The `d` property will be set to the item in the list and the value is automatically compiled to Javascript and returned as an output. So you might plug `[d.lng, d.lat]` into a ScatterplotLayerOp's `getPosition` field, or `d.population` into a ChoroplethLayerOp's `getFillColor` via a ColorRamp node.

## ExpressionOps

ExpressionOps are a special type of Operator that allows you to write custom javascript code. They are useful for *simple* data processing tasks that are not supported by the other Operators. They are a shorter version of a CodeOp meant to be used with only a single line, and the result of the expression is passed to the output.


## Savefiles

Savefiles are in JSON format and are a combination of [Theatre's Project savefile format](https://www.theatrejs.com/docs/latest/manual/projects) and [react-flow's savefile types](https://reactflow.dev/api-reference/types/react-flow-json-object) with some additions to support Noodles.gl.

JSON files stored in the `/public/noodles` directory can be loaded from the URL: **http://localhost:5173/?type=Noodles&project=ASC**, imported from the filesystem with the Menu on the bottom of the screen (File > Import), or saved to / loaded from the browser's OPFS storage by name.

The main info relevant to Noodles.gl is the `type` of the [Node object](https://reactflow.dev/api-reference/types/node) which determines which Operator type it creates, and the `data` property which is a JSON object that contains the inputs for the Operator.

# Developing

## Running
* `yarn start`

## Testing
* `yarn test`

## Features
We use Linear for project management and task tracking
