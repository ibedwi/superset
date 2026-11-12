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

describe("workflowApi engine connections", () => {
	function recordingApi(result: unknown) {
		const requests: Array<{ url: string; body: unknown }> = [];
		const answer = async (url: string | URL | Request, init?: RequestInit) => {
			requests.push({
				url: String(url),
				body: JSON.parse(String(init?.body)) as unknown,
			});
			return new Response(
				JSON.stringify({ result: { data: { json: result } } }),
			);
		};
		const api = workflowApi({
			apiUrl: "http://api.test",
			workerSecret: "secret",
			callOptions: {
				fetch: Object.assign(answer, { preconnect: fetch.preconnect }),
			},
		});
		return { api, requests };
	}

	test("listEngineConnections returns what the API sends", async () => {
		const connection = {
			id: "c1",
			provider: "inngest" as const,
			updatedAt: "1",
			eventKey: "e",
			signingKey: "s",
		};
		const { api, requests } = recordingApi([connection]);
		expect(await api.listEngineConnections()).toEqual([connection]);
		expect(requests[0]?.url).toBe(
			"http://api.test/api/trpc/workflowWorker.listEngineConnections",
		);
	});

	test("reportEngineConnection sends the version it acted on", async () => {
		const { api, requests } = recordingApi({ recorded: true });
		await api.reportEngineConnection({
			connectionId: "c1",
			version: "v1",
			status: "error",
			error: "boom",
		});
		expect(requests[0]?.body).toEqual({
			json: {
				connectionId: "c1",
				version: "v1",
				status: "error",
				error: "boom",
			},
		});
	});
});
