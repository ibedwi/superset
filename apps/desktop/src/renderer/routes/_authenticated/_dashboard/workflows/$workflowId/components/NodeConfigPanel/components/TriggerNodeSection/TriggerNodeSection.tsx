import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { describeSchedule } from "@superset/shared/rrule";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { LuPlus, LuX } from "react-icons/lu";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { cloudTrpc } from "renderer/lib/cloud-trpc";

// TODO(workflows): event triggers (GitHub, Slack, ...) — v1 edits schedules
// only; the trigger pipeline already dispatches any kind saved via the API.

interface TriggerNodeSectionProps {
	workflowId: string;
	disabled: boolean;
}

export function TriggerNodeSection({
	workflowId,
	disabled,
}: TriggerNodeSectionProps) {
	const { t } = useLingui();
	const utils = cloudTrpc.useUtils();
	const [time, setTime] = useState("09:00");

	const triggersQuery = cloudTrpc.workflow.listTriggers.useQuery({
		workflowId,
	});

	const invalidate = () => {
		void utils.workflow.listTriggers.invalidate({ workflowId });
		void utils.workflow.get.invalidate({ id: workflowId });
	};

	const saveMutation = useMutation({
		mutationFn: () => {
			const [hours = "9", minutes = "0"] = time.split(":");
			const start = new Date();
			start.setHours(Number(hours), Number(minutes), 0, 0);
			return apiTrpcClient.workflow.saveTrigger.mutate({
				workflowId,
				trigger: {
					config: {
						kind: "schedule",
						rrule: `FREQ=DAILY;BYHOUR=${Number(hours)};BYMINUTE=${Number(minutes)}`,
						dtstart: start.toISOString(),
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
				},
			});
		},
		onSuccess: invalidate,
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to save trigger" })),
			),
	});

	const deleteMutation = useMutation({
		mutationFn: (triggerId: string) =>
			apiTrpcClient.workflow.deleteTrigger.mutate({ workflowId, triggerId }),
		onSuccess: invalidate,
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to delete trigger" })),
			),
	});

	const triggers = triggersQuery.data ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				{triggers.length === 0 && (
					<p className="text-xs text-muted-foreground">
						<Trans>
							No triggers yet. The workflow only runs when started manually.
						</Trans>
					</p>
				)}
				{triggers.map((trigger) => (
					<div
						key={trigger.id}
						className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
					>
						<span className="truncate">
							{trigger.config.kind === "schedule"
								? describeSchedule(trigger.config.rrule)
								: trigger.kind}
						</span>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => deleteMutation.mutate(trigger.id)}
							disabled={disabled || deleteMutation.isPending}
							aria-label={t({ message: "Remove trigger" })}
						>
							<LuX className="size-3.5" />
						</Button>
					</div>
				))}
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Add a daily schedule</Trans>
				</Label>
				<div className="flex gap-2">
					<Input
						type="time"
						value={time}
						onChange={(event) => setTime(event.target.value)}
						disabled={disabled}
						className="w-32"
					/>
					<Button
						variant="outline"
						size="sm"
						onClick={() => saveMutation.mutate()}
						disabled={disabled || saveMutation.isPending}
					>
						<LuPlus className="size-3.5" />
						<Trans>Add</Trans>
					</Button>
				</div>
			</div>
		</div>
	);
}
