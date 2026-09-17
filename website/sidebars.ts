import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// Creating a sidebar enables you to:
// - create an ordered group of docs
// - render a sidebar for each doc of that group
// - provide next/previous navigation
//
// The sidebars can be generated from the filesystem, or explicitly defined here.
//
// Create as many sidebars as you want.
const sidebars: SidebarsConfig = {
	// Organized sidebar structure
	docs: [
		"intro",
		{
			type: "category",
			label: "Getting Started",
			collapsed: false,
			items: [
				"users/getting-started",
				"users/workflows-intro",
				"users/properties-panel",
				"users/operators-guide",
			],
		},
		{
			type: "category",
			label: "Working with Data",
			collapsed: true,
			items: ["users/data-guide", "users/expressions"],
		},
		{
			type: "category",
			label: "Visualization & Animation",
			collapsed: true,
			items: ["users/deckgl-maplibre-guide", "users/animation-and-rendering"],
		},
		{
			type: "category",
			label: "AI Assistant",
			collapsed: true,
			items: ["users/ai-assistant"],
		},
		{
			type: "category",
			label: "Reference",
			collapsed: true,
			items: ["users/api-keys", "users/comparison"],
		},
		{
			type: "category",
			label: "Framework Developers",
			collapsed: false,
			items: [
				{
					type: "category",
					label: "Getting Started",
					collapsed: false,
					items: ["developers/overview", "developers/contributing"],
				},
				{
					type: "category",
					label: "Core Concepts",
					collapsed: true,
					items: [
						"developers/creating-operators",
						"developers/field-system",
						"developers/data-flow",
						"developers/paths-containers",
					],
				},
				{
					type: "category",
					label: "Advanced Topics",
					collapsed: true,
					items: [
						"developers/node-based-tools",
						"developers/framework-extension",
						"developers/external-control-guide",
						"developers/utils-api-reference",
					],
				},
			],
		},
		"changelog",
	],
};

export default sidebars;
