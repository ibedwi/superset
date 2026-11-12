import { describe, expect, test } from "bun:test";
import { NodeError } from "../../engines/nodeError";
import { workflowApi } from "./workflowApi";

function apiAnswering(args: { status: number; code: string; message: string }) {
	const answer = async () =>
		new Response(
			JSON.stringify({
				error: {
					json: {
						message: args.message,
						data: { code: args.code },
					},
				},
			}),
			{ status: args.status },
		);
	return workflowApi({
		apiUrl: "http://api.test",
		workerSecret: "secret",
		callOptions: {
			fetch: Object.assign(answer, { preconnect: fetch.preconnect }),
		},
	});
}

const FINISHED = {
	status: 409,
	code: "CONFLICT",
	message: "Workflow run is already finished.",
};
const HANDLE = { hostId: "h", workspaceId: "w", terminalId: "t" };

describe("workflowApi", () => {
	test("observeAgent on a finished run fails with a non-retryable NodeError", async () => {
		const error = await apiAnswering(FINISHED)
			.observeAgent({ runId: "r", ...HANDLE })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(NodeError);
		expect(error).toMatchObject({ code: "RunFinished", retryable: false });
	});

	test("pollHostJob on a finished run fails with a non-retryable NodeError", async () => {
		const error = await apiAnswering(FINISHED)
			.pollHostJob({
				runId: "r",
				hostId: "h",
				jobId: "j",
				fromOffset: 0,
				waitMs: 0,
			})
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "RunFinished", retryable: false });
	});

	test("observeAgent leaves other API errors unchanged", async () => {
		const error = await apiAnswering({
			status: 500,
			code: "INTERNAL_SERVER_ERROR",
			message: "boom",
		})
			.observeAgent({ runId: "r", ...HANDLE })
			.catch((caught: unknown) => caught);
		expect(error).not.toBeInstanceOf(NodeError);
	});
});
