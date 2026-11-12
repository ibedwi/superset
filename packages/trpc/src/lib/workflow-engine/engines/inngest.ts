import type { InngestEngineConnection } from "@superset/shared/workflow-engine";
import { env } from "../../../env";
import { assertConnectionHostAllowed } from "../hostGuard";
import type { WorkflowEngine, WorkflowEngineConnection } from "../types";

const APP_ID = "paradev-workflows";
const RUN_REQUESTED_EVENT = "workflow/run.requested";
const RUN_CANCELED_EVENT = "workflow/run.canceled";

const NOT_CONFIGURED =
	"Workflow engine inngest is not configured: INNGEST_EVENT_KEY is not set.";

export async function organizationInngestClient(
	connection: InngestEngineConnection,
) {
	const { Inngest } = await import("inngest");
	return new Inngest({
		id: APP_ID,
		eventKey: connection.eventKey,
		isDev: false,
		...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
	});
}

async function deploymentInngestClient() {
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

async function inngestClient(connection: WorkflowEngineConnection | null) {
	if (!connection) return deploymentInngestClient();
	if (connection.provider !== "inngest") {
		throw new Error(`Connection ${connection.id} is not an Inngest connection`);
	}
	await assertConnectionHostAllowed({ connection });
	return organizationInngestClient(connection);
}

export const inngestWorkflowEngine: WorkflowEngine = {
	id: "inngest",

	async start({ runId, connection }) {
		const inngest = await inngestClient(connection);
		const { ids } = await inngest.send({
			id: `workflow-run-${runId}`,
			name: RUN_REQUESTED_EVENT,
			data: { runId },
		});
		return { engineRunId: ids[0] };
	},

	async cancel({ runId, connection }) {
		const inngest = await inngestClient(connection);
		await inngest.send({ name: RUN_CANCELED_EVENT, data: { runId } });
	},
};
