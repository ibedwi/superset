import { describe, expect, test } from "bun:test";
import { NodeError } from "../../nodeError";
import { decodeStepFailure, encodeStepFailure } from "./stepFailure";

describe("step failure transport", () => {
	test("keeps the code and message of a NodeError", () => {
		const error = new NodeError({
			message: "no agent",
			code: "AgentNotStarted",
			retryable: false,
		});
		expect(
			decodeStepFailure(new Error(encodeStepFailure(error))),
		).toMatchObject({
			code: "AgentNotStarted",
			message: "no agent",
			timedOut: false,
		});
	});

	test("keeps the timed-out flag", () => {
		const error = new NodeError({
			message: "slow",
			code: "NodeTimedOut",
			retryable: false,
			timedOut: true,
		});
		expect(
			decodeStepFailure(new Error(encodeStepFailure(error))),
		).toMatchObject({ code: "NodeTimedOut", timedOut: true });
	});

	test("wraps an unstructured message as a generic failure", () => {
		expect(decodeStepFailure(new Error("plain"))).toMatchObject({
			code: "StepFailed",
			message: "plain",
			timedOut: false,
			retryable: false,
		});
	});
});
