#!/usr/bin/env node

// Simple AccessorOp → CreateAttributeOp converter for batch migration
// Runs without browser dependencies

const fs = require("fs");
const path = require("path");

const EXAMPLES_DIR = path.join(__dirname, "../noodles-editor/src/examples");

function inferAttributeType(expression, fieldName) {
	// Infer size and type from field name and expression
	const isPosition = fieldName.toLowerCase().includes("position");
	const isColor = fieldName.toLowerCase().includes("color");

	// Check expression for array length
	const arrayMatch = /\[([^\]]+)\]/.exec(expression);
	if (arrayMatch) {
		const elements = arrayMatch[1].split(",").length;
		return {
			size: elements,
			type: isColor ? "uint8" : "float",
			outputType: "number",
		};
	}

	// Default based on field name
	if (isPosition) {
		return { size: 2, type: "float", outputType: "number" };
	} else if (isColor) {
		return { size: 4, type: "uint8", outputType: "number" };
	}

	return { size: 1, type: "float", outputType: "number" };
}

function convertProject(project) {
	const { nodes, edges } = project;
	let modified = false;

	// Find AccessorOp nodes
	const accessorNodes = nodes.filter((n) => n.type === "AccessorOp");

	if (accessorNodes.length === 0) {
		return project;
	}

	console.log(`  Found ${accessorNodes.length} AccessorOp nodes to convert`);

	// Convert each AccessorOp to CreateAttributeOp
	for (const node of accessorNodes) {
		const expression = node.data?.inputs?.expression || "d.value";

		// Find outgoing edges to determine attribute name
		const outEdges = edges.filter((e) => e.source === node.id);
		const fieldName =
			outEdges.length > 0
				? (outEdges[0].targetHandle || "position")
						.replace("par.get", "")
						.toLowerCase()
				: "value";

		const { size, type, outputType } = inferAttributeType(
			expression,
			fieldName,
		);

		// Convert node
		node.type = "CreateAttributeOp";
		node.data = {
			...node.data,
			inputs: {
				name: fieldName,
				expression,
				size,
				type,
				outputType,
			},
		};

		// Update edges: accessor -> data
		for (const edge of edges) {
			if (edge.source === node.id && edge.sourceHandle === "out.accessor") {
				edge.sourceHandle = "out.data";
				modified = true;
			}

			// Update target: par.get* -> par.data
			if (edge.target === node.id || edge.source === node.id) {
				if (edge.targetHandle && edge.targetHandle.startsWith("par.get")) {
					edge.targetHandle = "par.data";
					modified = true;
				}
			}
		}

		modified = true;
	}

	if (modified) {
		project.version = Math.max(project.version || 0, 15);
	}

	return project;
}

async function main() {
	console.log("🔄 Converting AccessorOp → CreateAttributeOp\n");

	const examples = fs.readdirSync(EXAMPLES_DIR);
	let converted = 0;

	for (const example of examples) {
		const noodlesPath = path.join(EXAMPLES_DIR, example, "noodles.json");

		if (!fs.existsSync(noodlesPath)) {
			continue;
		}

		console.log(`📁 ${example}`);

		try {
			const content = fs.readFileSync(noodlesPath, "utf8");
			const project = JSON.parse(content);
			const converted_project = convertProject(project);

			if (JSON.stringify(project) !== JSON.stringify(converted_project)) {
				fs.writeFileSync(
					noodlesPath,
					JSON.stringify(converted_project, null, 2) + "\n",
				);
				console.log(`  ✅ Converted\n`);
				converted++;
			} else {
				console.log(`  - No changes needed\n`);
			}
		} catch (e) {
			console.error(`  ❌ Error: ${e.message}\n`);
		}
	}

	console.log(`\n📊 Summary: ${converted} projects converted`);
}

main().catch(console.error);
