/**
 * Thrown inside a step when this worker is shutting down. It is a plain
 * Error on purpose: Inngest counts it as a retryable failure and runs the
 * step again on another worker.
 */
export class WorkerStoppingError extends Error {
	constructor() {
		super("Worker is shutting down; the step runs again on another worker");
		this.name = "WorkerStoppingError";
	}
}
