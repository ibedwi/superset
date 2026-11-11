import { db } from "@superset/db/client";
import { automationEvents, workflows } from "@superset/db/schema";
import { dispatchWorkflow } from "@superset/trpc/workflow-dispatch";
import { eq } from "drizzle-orm";
import { verifyQstashRequest } from "@/lib/verifyQstash";
import { workflowRunPayloadSchema } from "../../runPayloadSchema";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const body = await request.text();
	const { id } = await params;
	const rejected = await verifyQstashRequest(
		request,
		body,
		`/api/workflows/dispatch/${id}`,
	);
	if (rejected) return rejected;

	const parsed = workflowRunPayloadSchema.safeParse(JSON.parse(body));
	if (!parsed.success) {
		console.error("[workflows/dispatch] invalid payload", parsed.error);
		return Response.json({ error: "Invalid payload" }, { status: 400 });
	}

	const [workflow] = await db
		.select({
			id: workflows.id,
			organizationId: workflows.organizationId,
			name: workflows.name,
			liveVersionId: workflows.liveVersionId,
			enabled: workflows.enabled,
			archivedAt: workflows.archivedAt,
		})
		.from(workflows)
		.where(eq(workflows.id, parsed.data.workflowId))
		.limit(1);

	if (!workflow) return Response.json({ ok: true, skipped: "deleted" });
	if (workflow.archivedAt)
		return Response.json({ ok: true, skipped: "archived" });
	if (!workflow.enabled)
		return Response.json({ ok: true, skipped: "disabled" });

	// Snapshotted here because automation_events.payload is nulled by
	// retention, and a long run must not race the pruner.
	let triggerContext: unknown;
	if ("eventId" in parsed.data) {
		const [event] = await db
			.select({ payload: automationEvents.payload })
			.from(automationEvents)
			.where(eq(automationEvents.id, parsed.data.eventId))
			.limit(1);
		triggerContext = event?.payload ?? undefined;
	}

	const outcome = await dispatchWorkflow(
		"scheduledFor" in parsed.data
			? {
					workflow,
					scheduledFor: new Date(parsed.data.scheduledFor),
					triggerId: parsed.data.triggerId,
					triggerContext,
				}
			: {
					workflow,
					trigger: {
						triggerId: parsed.data.triggerId,
						eventId: parsed.data.eventId,
					},
					triggerContext,
				},
	);

	return Response.json({ ok: true, outcome });
}
