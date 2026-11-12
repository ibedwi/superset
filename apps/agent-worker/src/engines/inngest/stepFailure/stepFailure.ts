import { NodeError } from "../../nodeError";

const TIMED_OUT_FLAG = "timed_out";
const ENCODED = /^\[(\w+)(?:,(timed_out))?\] ([\s\S]*)$/;

/** Inngest keeps only the message of a step error, so code and timeout ride in it. */
export function encodeStepFailure(error: unknown): string {
	if (error instanceof NodeError) {
		const flag = error.timedOut ? `,${TIMED_OUT_FLAG}` : "";
		return `[${error.code}${flag}] ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}

export function decodeStepFailure(error: unknown): NodeError {
	const message = error instanceof Error ? error.message : String(error);
	const match = ENCODED.exec(message);
	return new NodeError({
		message: match?.[3] ?? message,
		code: match?.[1] ?? "StepFailed",
		retryable: false,
		timedOut: match?.[2] === TIMED_OUT_FLAG,
	});
}
