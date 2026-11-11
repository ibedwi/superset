import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "@tanstack/react-router";
import { useNow } from "renderer/hooks/useNow";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import {
	earliestNextRun,
	formatNextRun,
	timeZoneShortName,
} from "../../../../../../utils/scheduleTime";

export function TriggerCardBody() {
	const { t } = useLingui();
	const { workflowId } = useParams({ strict: false });
	const now = useNow(60_000);
	const triggersQuery = cloudTrpc.workflow.listTriggers.useQuery(
		{ workflowId: workflowId ?? "" },
		{ enabled: !!workflowId },
	);
	const triggers = triggersQuery.data;
	if (!triggers) return null;

	const scheduleCount = triggers.filter(
		(trigger) => trigger.config.kind === "schedule",
	).length;
	const next = earliestNextRun(triggers);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="text-sm">
				{scheduleCount === 0 ? (
					<Trans>Manual start only</Trans>
				) : (
					t({
						message: plural(scheduleCount, {
							one: "Manual + # schedule",
							other: "Manual + # schedules",
						}),
					})
				)}
			</div>
			<div className="text-xs text-muted-foreground">
				{next ? (
					<Trans>
						Next: {formatNextRun(next.at, now, next.timeZone)}{" "}
						{next.timeZone ? timeZoneShortName(next.timeZone, next.at) : ""}
					</Trans>
				) : (
					<Trans>No scheduled runs</Trans>
				)}
			</div>
		</div>
	);
}
