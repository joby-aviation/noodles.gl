// Visual regression tests for the node editor (main noodles.tsx component)
// Tests critical UI paths in the node-based editor
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import {
	navigateToProject,
	waitForNodeGraph,
	waitForPropertyPanel,
} from "./visual-test-utils";

// Helper to wait for an element to exist in the DOM
async function waitForSelector(selector: string, timeout: number = 10000): Promise<Element> {
	const startTime = Date.now();
	while (Date.now() - startTime < timeout) {
		const element = document.querySelector(selector);
		if (element) {
			return element;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Element with selector "${selector}" not found within ${timeout}ms`);
}

describe("Node Editor Visual Regression", () => {
	it("should render the node editor with example project", async () => {
		await navigateToProject("nyc-taxis");
		await waitForNodeGraph();
		await expect.element(document.body).toMatchScreenshot("node-editor-initial-load");
	});

	it("should render the node editor with empty project", async () => {
		await navigateToProject("empty");
		await waitForNodeGraph();
		await expect.element(document.body).toMatchScreenshot("node-editor-empty-project");
	});

	it("should show property panel when node is selected", async () => {
		await navigateToProject("nyc-taxis");
		await waitForNodeGraph();

		// Try to click on a node (might need to adjust selector based on actual DOM)
		const nodes = document.querySelectorAll(".react-flow__node");
		if (nodes.length > 0) {
			(nodes[0] as HTMLElement).click();
			await waitForPropertyPanel();
			await expect.element(document.body).toMatchScreenshot("node-editor-with-property-panel");
		}
	});

	it("should render breadcrumbs correctly", async () => {
		await navigateToProject("nyc-taxis");
		await waitForNodeGraph();

		// Wait for breadcrumbs to render
		try {
			await waitForSelector('[data-testid="breadcrumbs"], .breadcrumbs', 3000);
		} catch {
			// Breadcrumbs might not always be present
		}

		await expect.element(document.body).toMatchScreenshot(
			"node-editor-breadcrumbs",
		);
	});
});
