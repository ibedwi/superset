import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { testWorkflowEngineConnection } from "./connectionTest";

let silent: Server;
let port = 0;

beforeAll(async () => {
	silent = createServer(() => {});
	await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
	const address = silent.address();
	port = typeof address === "object" && address ? address.port : 0;
});

afterAll(() => {
	silent.close();
});

describe("testWorkflowEngineConnection", () => {
	test("a Temporal server that never answers fails within the deadline", async () => {
		await expect(
			testWorkflowEngineConnection({
				connection: {
					id: "c1",
					provider: "temporal",
					updatedAt: "1",
					address: `127.0.0.1:${port}`,
					namespace: "default",
					tls: false,
				},
				deadlineMs: 100,
			}),
		).rejects.toThrow();
	});

	test("a Temporal address nobody listens on fails", async () => {
		await expect(
			testWorkflowEngineConnection({
				connection: {
					id: "c2",
					provider: "temporal",
					updatedAt: "1",
					address: "127.0.0.1:1",
					namespace: "default",
					tls: false,
				},
				deadlineMs: 500,
			}),
		).rejects.toThrow();
	});

	test("an Inngest server that never answers fails within the deadline", async () => {
		await expect(
			testWorkflowEngineConnection({
				connection: {
					id: "c3",
					provider: "inngest",
					updatedAt: "1",
					baseUrl: `http://127.0.0.1:${port}`,
					eventKey: "event-key-1234",
					signingKey: "signing-key-1234",
				},
				deadlineMs: 100,
			}),
		).rejects.toThrow(/did not answer within 100 ms/);
	});
});
