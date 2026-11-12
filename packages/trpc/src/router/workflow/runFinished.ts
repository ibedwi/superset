import { TRPCError } from "@trpc/server";

const FINISHED_STATUSES: ReadonlySet<string> = new Set([
	"succeeded",
	"failed",
	"canceled",
	"timed_out",
]);

export const RUN_FINISHED_MESSAGE = "Workflow run is already finished.";

export function runFinished() {
	return new TRPCError({ code: "CONFLICT", message: RUN_FINISHED_MESSAGE });
}

export function assertRunActive(run: { status: string }): void {
	if (FINISHED_STATUSES.has(run.status)) throw runFinished();
}
