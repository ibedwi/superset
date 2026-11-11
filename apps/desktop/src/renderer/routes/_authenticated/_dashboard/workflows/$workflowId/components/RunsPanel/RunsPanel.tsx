import {
	formatCompactRelativeTime,
	formatElapsed,
} from "@superset/i18n/format";
import { Button } from "@superset/ui/button";
import { Skeleton } from "@superset/ui/skeleton";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { useNow } from "renderer/hooks/useNow";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import {
	RUN_CAUSE_LABELS,
	RUN_STATUS_META,
	runCause,
} from "../../../utils/runStatus";

const PAGE_SIZE = 25;

interface RunsPanelProps {
	workflowId: string;
	selectedRunId: string | null;
	onSelectRun: (runId: string) => void;
}

export function RunsPanel({
	workflowId,
	selectedRunId,
	onSelectRun,
}: RunsPanelProps) {
	const now = useNow(30_000);
	const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
		cloudTrpc.workflow.listRuns.useInfiniteQuery(
			{ workflowId, limit: PAGE_SIZE },
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
				refetchInterval: 10_000,
			},
		);

	const runs = useMemo(
		() => data?.pages.flatMap((page) => page.items) ?? [],
		[data],
	);

	if (isPending) {
		return (
			<div className="flex flex-col gap-2 p-4">
				{["a", "b", "c"].map((key) => (
					<Skeleton key={key} className="h-12 w-full" />
				))}
			</div>
		);
	}

	if (runs.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
				No runs yet. Use Run now to start one.
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<ul className="flex flex-col">
				{runs.map((run) => {
					const meta = RUN_STATUS_META[run.status];
					const started = run.startedAt ?? run.createdAt;
					return (
						<li key={run.id}>
							<button
								type="button"
								onClick={() => onSelectRun(run.id)}
								className={cn(
									"flex w-full flex-col gap-1 border-b px-4 py-2.5 text-left hover:bg-accent/50",
									selectedRunId === run.id && "bg-accent",
								)}
							>
								<span className="flex items-center gap-2">
									<span className={cn("size-2 rounded-full", meta.dot)} />
									<span className="text-sm font-medium">{meta.label}</span>
									<span className="ml-auto text-xs text-muted-foreground">
										{formatCompactRelativeTime(new Date(started), now)}
									</span>
								</span>
								<span className="flex items-center gap-2 text-xs text-muted-foreground">
									<span>{RUN_CAUSE_LABELS[runCause(run)]}</span>
									{run.startedAt && run.finishedAt && (
										<span>
											{formatElapsed(
												new Date(run.startedAt),
												new Date(run.finishedAt),
											)}
										</span>
									)}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			{hasNextPage && (
				<div className="flex justify-center p-3">
					<Button
						variant="outline"
						size="sm"
						disabled={isFetchingNextPage}
						onClick={() => void fetchNextPage()}
					>
						{isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}
		</div>
	);
}
