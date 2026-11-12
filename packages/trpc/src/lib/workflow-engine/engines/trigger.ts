import { env } from "../../../env";
import type { WorkflowEngine } from "../types";

const TASK_ID = "workflow-run";

const NOT_CONFIGURED =
	"Workflow engine trigger is not configured: TRIGGER_SECRET_KEY is not set.";

async function withTriggerAuth<T>(
	use: (sdk: typeof import("@trigger.dev/sdk")) => Promise<T>,
): Promise<T> {
	const secretKey = env.TRIGGER_SECRET_KEY;
	if (!secretKey) throw new Error(NOT_CONFIGURED);
	const sdk = await import("@trigger.dev/sdk");
	return sdk.auth.withAuth(
		{
			accessToken: secretKey,
			...(env.TRIGGER_API_URL ? { baseURL: env.TRIGGER_API_URL } : {}),
		},
		() => use(sdk),
	);
}

export const triggerWorkflowEngine: WorkflowEngine = {
	id: "trigger",

	start: ({ runId }) =>
		withTriggerAuth(async ({ tasks }) => {
			const handle = await tasks.trigger(
				TASK_ID,
				{ runId },
				{ idempotencyKey: `workflow-run-${runId}` },
			);
			return { engineRunId: handle.id };
		}),

	cancel: ({ engineRunId }) =>
		withTriggerAuth(async ({ runs }) => {
			if (engineRunId) await runs.cancel(engineRunId);
		}),
};
