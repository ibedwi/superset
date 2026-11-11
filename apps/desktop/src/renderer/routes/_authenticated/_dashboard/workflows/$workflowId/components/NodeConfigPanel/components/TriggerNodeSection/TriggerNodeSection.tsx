import { describeSchedule } from "@superset/shared/rrule";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Skeleton } from "@superset/ui/skeleton";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
	LuCalendar,
	LuCircleAlert,
	LuLoaderCircle,
	LuPlay,
	LuPlus,
	LuX,
} from "react-icons/lu";
import { useNow } from "renderer/hooks/useNow";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import {
	earliestNextRun,
	formatNextRun,
	nextDailyOccurrence,
	timeZoneLabel,
} from "../../../../utils/scheduleTime";

// TODO(workflows): event triggers (GitHub, Slack, ...) — v1 edits schedules
// only; the trigger pipeline already dispatches any kind saved via the API.

const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface TriggerNodeSectionProps {
	workflowId: string;
	disabled: boolean;
}

export function TriggerNodeSection({
	workflowId,
	disabled,
}: TriggerNodeSectionProps) {
	const utils = cloudTrpc.useUtils();
	const now = useNow(60_000);
	const [composerOpen, setComposerOpen] = useState(false);
	const [time, setTime] = useState("09:00");

	const triggersQuery = cloudTrpc.workflow.listTriggers.useQuery({
		workflowId,
	});

	const invalidate = () =>
		Promise.all([
			utils.workflow.listTriggers.invalidate({ workflowId }),
			utils.workflow.get.invalidate({ id: workflowId }),
		]);

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
						timezone: DEVICE_TIME_ZONE,
					},
				},
			});
		},
		onSuccess: async () => {
			await invalidate();
			setComposerOpen(false);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (triggerId: string) =>
			apiTrpcClient.workflow.deleteTrigger.mutate({ workflowId, triggerId }),
		onSuccess: invalidate,
	});

	if (triggersQuery.isPending) {
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}

	if (triggersQuery.isError) {
		return (
			<div className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
				<div className="flex items-center gap-2 text-sm font-medium">
					<LuCircleAlert className="size-4 text-destructive" />
					Schedules unavailable
				</div>
				<p className="text-xs text-muted-foreground">
					Could not load schedules. Automatic starts may still be active.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() => void triggersQuery.refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}

	const triggers = triggersQuery.data;
	const next = earliestNextRun(triggers);
	const scheduleCount = triggers.length;
	const firstRun = nextDailyOccurrence(time, now);

	if (composerOpen) {
		return (
			<div className="flex flex-col gap-4">
				<div className="border-t" />
				<div className="flex flex-col gap-1">
					<div className="text-sm font-medium">Add daily schedule</div>
					<p className="text-xs text-muted-foreground">
						Creates an additional daily start. Existing schedules stay active.
					</p>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="workflow-schedule-time">Time</Label>
					<Input
						id="workflow-schedule-time"
						type="time"
						value={time}
						onChange={(event) => setTime(event.target.value)}
						disabled={saveMutation.isPending}
						aria-invalid={!firstRun}
					/>
					{!firstRun && (
						<p className="text-xs text-destructive">Choose a time.</p>
					)}
				</div>
				<div className="text-xs text-muted-foreground">
					<div>Device timezone</div>
					<div className="text-foreground/80">
						{timeZoneLabel(DEVICE_TIME_ZONE)}
					</div>
				</div>
				{firstRun && (
					<>
						<div className="border-t" />
						<div className="flex flex-col gap-1">
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
								First scheduled run
							</div>
							<div className="text-sm">
								{formatNextRun(firstRun, now, DEVICE_TIME_ZONE)}
							</div>
						</div>
					</>
				)}
				{saveMutation.isError && (
					<div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
						<LuCircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
						<div>
							<div className="text-destructive">
								Could not add schedule. Try again.
							</div>
							<div className="text-muted-foreground">
								Your existing schedules are unchanged.
							</div>
						</div>
					</div>
				)}
				<div className="flex flex-col gap-2">
					<Button
						onClick={() => saveMutation.mutate()}
						disabled={!firstRun || saveMutation.isPending}
					>
						{saveMutation.isPending ? (
							<>
								<LuLoaderCircle className="size-3.5 animate-spin" />
								Adding…
							</>
						) : saveMutation.isError ? (
							"Try again"
						) : (
							"Add daily schedule"
						)}
					</Button>
					<Button
						variant="outline"
						onClick={() => {
							saveMutation.reset();
							setComposerOpen(false);
						}}
						disabled={saveMutation.isPending}
					>
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	const addButton = !disabled && (
		<Button
			variant="outline"
			className="w-full"
			onClick={() => setComposerOpen(true)}
		>
			<LuPlus className="size-3.5" />
			Add daily schedule
		</Button>
	);

	if (triggers.length === 0) {
		return (
			<div className="flex flex-col gap-3">
				<div className="border-t" />
				<div className="flex flex-col gap-1">
					<div className="text-sm font-medium">Manual start only</div>
					<p className="text-xs text-muted-foreground">
						Use Run now in the toolbar to start this workflow. No automatic runs
						are scheduled.
					</p>
				</div>
				{addButton}
				{addButton && (
					<p className="text-xs text-muted-foreground">
						Adding a schedule keeps manual runs available.
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="border-t" />
			{next && (
				<div className="flex flex-col gap-1">
					<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
						Next scheduled run
					</div>
					<div className="text-2xl font-light tracking-tight">
						{formatNextRun(next.at, now, next.timeZone)}
					</div>
					{next.timeZone && (
						<div className="text-xs text-muted-foreground">
							{timeZoneLabel(next.timeZone, next.at)}
						</div>
					)}
				</div>
			)}
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<LuPlay className="size-3.5" />
				You can also use Run now at any time.
			</div>

			<div className="border-t" />

			<div className="flex flex-col gap-3">
				<div className="text-sm font-medium">Schedules · {scheduleCount}</div>
				{triggers.map((trigger) => {
					const removing =
						deleteMutation.isPending && deleteMutation.variables === trigger.id;
					const schedule =
						trigger.config.kind === "schedule" ? trigger.config : null;
					return (
						<div key={trigger.id} className="flex items-start gap-3">
							<LuCalendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<div className="text-sm">
									{schedule ? describeSchedule(schedule.rrule) : trigger.kind}
								</div>
								{schedule?.timezone && (
									<div className="text-xs text-muted-foreground">
										{timeZoneLabel(schedule.timezone)}
									</div>
								)}
								{trigger.nextRunAt && (
									<div className="text-xs text-muted-foreground">
										Next{" "}
										{formatNextRun(
											new Date(trigger.nextRunAt),
											now,
											schedule?.timezone,
										)}
									</div>
								)}
							</div>
							{!disabled && (
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={() => deleteMutation.mutate(trigger.id)}
									disabled={deleteMutation.isPending}
									aria-label="Remove schedule"
								>
									{removing ? (
										<LuLoaderCircle className="size-3.5 animate-spin" />
									) : (
										<LuX className="size-3.5" />
									)}
								</Button>
							)}
						</div>
					);
				})}
				{deleteMutation.isError && (
					<p className="text-xs text-destructive">
						Could not remove the schedule. Try again.
					</p>
				)}
				{addButton}
			</div>

			<p className="text-xs text-muted-foreground">
				Schedules save immediately.
			</p>
		</div>
	);
}
