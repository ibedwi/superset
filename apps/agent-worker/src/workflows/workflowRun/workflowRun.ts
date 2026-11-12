import { runGraph } from "../../engines/runGraph";
import { runWithCancelCleanup } from "../../engines/temporal/cancelCleanup";
import { createTemporalContext } from "../../engines/temporal/temporalContext";

export async function workflowRun(args: { runId: string }): Promise<void> {
	await runWithCancelCleanup({
		ctx: createTemporalContext(),
		runId: args.runId,
		run: (ctx) => runGraph({ ctx, runId: args.runId }),
	});
}
