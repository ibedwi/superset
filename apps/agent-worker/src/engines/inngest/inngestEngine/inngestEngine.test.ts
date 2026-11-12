import { describe, expect, test } from "bun:test";
import { stopAbortingFirst } from "./inngestEngine";

describe("stopAbortingFirst", () => {
	test("aborts the runtime signal before the connection drains", async () => {
		const shutdown = new AbortController();
		const abortedWhenDraining: boolean[] = [];
		const connection = {
			close: async () => {
				abortedWhenDraining.push(shutdown.signal.aborted);
			},
		};
		await stopAbortingFirst({ shutdown, connection });
		expect(abortedWhenDraining).toEqual([true]);
	});

	test("waits for the connection to close", async () => {
		const order: string[] = [];
		const connection = {
			close: async () => {
				await Promise.resolve();
				order.push("closed");
			},
		};
		await stopAbortingFirst({ shutdown: new AbortController(), connection });
		order.push("returned");
		expect(order).toEqual(["closed", "returned"]);
	});
});
