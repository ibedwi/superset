import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";

const bundles = [
	{ entry: "../src/workflows/index.ts", output: "../dist/workflow-bundle.js" },
	{
		entry: "../src/workflows/connectionWorkflows.ts",
		output: "../dist/workflow-bundle-connections.js",
	},
];

mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
for (const { entry, output } of bundles) {
	const { code } = await bundleWorkflowCode({
		workflowsPath: fileURLToPath(new URL(entry, import.meta.url)),
	});
	writeFileSync(new URL(output, import.meta.url), code);
}
