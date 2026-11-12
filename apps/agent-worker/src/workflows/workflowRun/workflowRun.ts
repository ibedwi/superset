import { runGraph } from "../../engines/runGraph";
import { createTemporalContext } from "../../engines/temporal/temporalContext";

export async function workflowRun(args: { runId: string }): Promise<void> {
	await runGraph({ ctx: createTemporalContext(), runId: args.runId });
}
