import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";

export type WorkflowSource =
	| { workflowBundle: { codePath: string } }
	| { workflowBundle: { code: string } }
	| { workflowsPath: string };

/** A built image ships the workflows already bundled; a checkout bundles them at start. */
export function deploymentWorkflowSource(): WorkflowSource {
	const bundle = fileURLToPath(
		new URL("./workflow-bundle.js", import.meta.url),
	);
	if (existsSync(bundle)) return { workflowBundle: { codePath: bundle } };
	return {
		workflowsPath: fileURLToPath(
			new URL("../../../workflows/index.ts", import.meta.url),
		),
	};
}

let bundledFromSource:
	| Promise<{ workflowBundle: { code: string } }>
	| undefined;

/** Only `workflowRun`. A checkout bundles once and every connection reuses it. */
export async function connectionWorkflowSource(): Promise<WorkflowSource> {
	const bundle = fileURLToPath(
		new URL("./workflow-bundle-connections.js", import.meta.url),
	);
	if (existsSync(bundle)) return { workflowBundle: { codePath: bundle } };
	bundledFromSource ??= bundleWorkflowCode({
		workflowsPath: fileURLToPath(
			new URL("../../../workflows/connectionWorkflows.ts", import.meta.url),
		),
	}).then(({ code }) => ({ workflowBundle: { code } }));
	return bundledFromSource;
}
