import {
	type InngestEngineConnection,
	type TemporalEngineConnection,
	temporalConnectOptions,
	type WorkflowEngineConnection,
} from "@superset/shared/workflow-engine";
import { organizationInngestClient } from "../engines/inngest";

export const CONNECTION_TEST_DEADLINE_MS = 5000;
export const CONNECTION_TEST_EVENT = "workflow/connection.test";

function withDeadline<T>(args: {
	work: Promise<T>;
	deadlineMs: number;
	message: string;
}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(args.message)),
			args.deadlineMs,
		);
		args.work.then(resolve, reject).finally(() => clearTimeout(timer));
	});
}

async function testTemporal(args: {
	connection: TemporalEngineConnection;
	deadlineMs: number;
}): Promise<void> {
	const { Connection } = await import("@temporalio/client");
	const message = `Temporal did not answer within ${args.deadlineMs} ms.`;
	const connecting = Connection.connect({
		...temporalConnectOptions(args.connection),
		connectTimeout: args.deadlineMs,
	});
	try {
		const connection = await withDeadline({
			work: connecting,
			deadlineMs: args.deadlineMs,
			message,
		});
		try {
			await withDeadline({
				work: connection.withDeadline(Date.now() + args.deadlineMs, () =>
					connection.workflowService.describeNamespace({
						namespace: args.connection.namespace,
					}),
				),
				deadlineMs: args.deadlineMs,
				message,
			});
		} finally {
			await connection.close();
		}
	} catch (error) {
		connecting.then(
			(late) => late.close(),
			() => undefined,
		);
		throw error;
	}
}

async function testInngest(args: {
	connection: InngestEngineConnection;
	deadlineMs: number;
}): Promise<void> {
	const inngest = await organizationInngestClient(args.connection);
	await withDeadline({
		work: inngest.send({ name: CONNECTION_TEST_EVENT, data: {} }),
		deadlineMs: args.deadlineMs,
		message: `Inngest did not answer within ${args.deadlineMs} ms.`,
	});
}

/** Throws with the provider's reason. Only the worker can prove an Inngest signing key. */
export function testWorkflowEngineConnection(args: {
	connection: WorkflowEngineConnection;
	deadlineMs?: number;
}): Promise<void> {
	const deadlineMs = args.deadlineMs ?? CONNECTION_TEST_DEADLINE_MS;
	return args.connection.provider === "temporal"
		? testTemporal({ connection: args.connection, deadlineMs })
		: testInngest({ connection: args.connection, deadlineMs });
}
