import { describe, expect, test } from "bun:test";
import type { EngineHandle } from "../../engineHandle";
import { withStartDeadline } from "./startDeadline";

function handle(): EngineHandle & { stopped: boolean } {
	const made = {
		stopped: false,
		closed: new Promise<void>(() => {}),
		isRunning: () => true,
		async stop() {
			made.stopped = true;
		},
	};
	return made;
}

describe("withStartDeadline", () => {
	test("returns the engine when it starts in time", async () => {
		const engine = handle();
		const result = await withStartDeadline({
			start: Promise.resolve(engine),
			deadlineMs: 1000,
			message: "late",
		});
		expect(result).toBe(engine);
	});

	test("fails with the message when the engine does not start in time", async () => {
		await expect(
			withStartDeadline({
				start: new Promise<EngineHandle>(() => {}),
				deadlineMs: 1,
				message: "did not connect in time",
			}),
		).rejects.toThrow("did not connect in time");
	});

	test("stops an engine that comes up after the deadline", async () => {
		const engine = handle();
		let release: (value: EngineHandle) => void = () => {};
		const start = new Promise<EngineHandle>((resolve) => {
			release = resolve;
		});
		await withStartDeadline({ start, deadlineMs: 1, message: "late" }).catch(
			() => {},
		);
		release(engine);
		await Promise.resolve();
		await Promise.resolve();
		expect(engine.stopped).toBe(true);
	});

	test("passes a start failure through", async () => {
		await expect(
			withStartDeadline({
				start: Promise.reject(new Error("bad certificate")),
				deadlineMs: 1000,
				message: "late",
			}),
		).rejects.toThrow("bad certificate");
	});
});
