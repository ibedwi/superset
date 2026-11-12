import { env } from "../../../env";
import type { WorkflowEngine } from "../types";

const APP_ID = "paradev-workflows";
const RUN_REQUESTED_EVENT = "workflow/run.requested";
const RUN_CANCELED_EVENT = "workflow/run.canceled";

const NOT_CONFIGURED =
	"Workflow engine inngest is not configured: INNGEST_EVENT_KEY is not set.";

async function inngestClient() {
	const isDev = env.INNGEST_DEV === "1";
	if (!env.INNGEST_EVENT_KEY && !isDev) throw new Error(NOT_CONFIGURED);
	const { Inngest } = await import("inngest");
	return new Inngest({
		id: APP_ID,
		...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
		...(env.INNGEST_BASE_URL ? { baseUrl: env.INNGEST_BASE_URL } : {}),
		...(env.INNGEST_DEV ? { isDev } : {}),
	});
}

export const inngestWorkflowEngine: WorkflowEngine = {
	id: "inngest",

	async start({ runId }) {
		const inngest = await inngestClient();
		const { ids } = await inngest.send({
			id: `workflow-run-${runId}`,
			name: RUN_REQUESTED_EVENT,
			data: { runId },
		});
		return { engineRunId: ids[0] };
	},

	async cancel({ runId }) {
		const inngest = await inngestClient();
		await inngest.send({ name: RUN_CANCELED_EVENT, data: { runId } });
	},
};
