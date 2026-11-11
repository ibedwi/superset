import { z } from "zod";

/**
 * The QStash body a workflow run is enqueued with. A run comes from a
 * schedule or from an event, never both — same contract as the automation
 * payload, keyed by workflow instead.
 */
export const workflowRunPayloadSchema = z.union([
	z
		.object({
			workflowId: z.string().uuid(),
			scheduledFor: z.string().datetime(),
			triggerId: z.string().uuid().optional(),
		})
		.strict(),
	z
		.object({
			workflowId: z.string().uuid(),
			triggerId: z.string().uuid(),
			eventId: z.string().uuid(),
		})
		.strict(),
]);

export type WorkflowRunPayload = z.infer<typeof workflowRunPayloadSchema>;
