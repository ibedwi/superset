import { errorMessage } from "@superset/i18n/errors";
import {
	formatCompactRelativeTime,
	formatElapsed,
} from "@superset/i18n/format";
import { Button } from "@superset/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@superset/ui/empty";
import { Skeleton } from "@superset/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superset/ui/table";
import { cn } from "@superset/ui/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	LuArrowLeft,
	LuHistory,
	LuRotateCw,
	LuTriangleAlert,
} from "react-icons/lu";
import { useNow } from "renderer/hooks/useNow";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { DATA_TABLE_HEAD_CELL } from "renderer/routes/_authenticated/_dashboard/components/DataTableHeader";
import {
	RUN_CAUSE_LABELS,
	RUN_STATUS_META,
	runCause,
} from "../utils/runStatus";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/workflows/runs/",
)({
	component: WorkflowRunsPage,
});

const PAGE_SIZE = 50;

function WorkflowRunsPage() {
	const navigate = useNavigate();
	const now = useNow(30_000);

	const {
		data,
		isPending,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = cloudTrpc.workflow.listOrgRuns.useInfiniteQuery(
		{ limit: PAGE_SIZE },
		{
			getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
			refetchInterval: 15_000,
		},
	);

	const runs = useMemo(
		() => data?.pages.flatMap((page) => page.items) ?? [],
		[data],
	);

	const showLoading = isPending && runs.length === 0;
	const showError = isError && runs.length === 0;

	return (
		<div className="flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="drag h-10 shrink-0" />

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 pb-12">
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => navigate({ to: "/workflows" })}
							aria-label="Back to workflows"
						>
							<LuArrowLeft className="size-4" />
						</Button>
						<h1 className="font-semibold text-xl tracking-tight">
							All workflow runs
						</h1>
					</div>

					<div className="mt-6">
						{showLoading ? (
							<div className="space-y-2">
								{["a", "b", "c", "d", "e", "f"].map((key) => (
									<Skeleton key={key} className="h-10 w-full" />
								))}
							</div>
						) : showError ? (
							<Empty className="rounded-xl border border-border py-16">
								<EmptyHeader>
									<EmptyMedia
										variant="icon"
										className="size-14 [&_svg:not([class*='size-'])]:size-7"
									>
										<LuTriangleAlert />
									</EmptyMedia>
									<EmptyTitle>Couldn't load runs</EmptyTitle>
									<EmptyDescription className="select-text cursor-text">
										{errorMessage(error, "The request failed.")}
									</EmptyDescription>
								</EmptyHeader>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										void refetch();
									}}
								>
									<LuRotateCw className="size-4" />
									Try again
								</Button>
							</Empty>
						) : runs.length === 0 ? (
							<Empty className="rounded-xl border border-border py-16">
								<EmptyHeader>
									<EmptyMedia
										variant="icon"
										className="size-14 [&_svg:not([class*='size-'])]:size-7"
									>
										<LuHistory />
									</EmptyMedia>
									<EmptyTitle>No runs yet</EmptyTitle>
									<EmptyDescription>
										Runs appear here once a workflow fires.
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<div className="rounded-xl border border-border">
								<Table className="table-fixed">
									<TableHeader className="sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--color-border)] [&_th]:bg-background [&_tr>th:first-child]:rounded-tl-xl [&_tr>th:last-child]:rounded-tr-xl [&_tr]:border-b-0">
										<TableRow className="hover:bg-transparent">
											<TableHead className={cn(DATA_TABLE_HEAD_CELL, "pl-4")}>
												Workflow
											</TableHead>
											<TableHead
												className={cn(DATA_TABLE_HEAD_CELL, "w-[16%]")}
											>
												Status
											</TableHead>
											<TableHead
												className={cn(DATA_TABLE_HEAD_CELL, "w-[14%]")}
											>
												Trigger
											</TableHead>
											<TableHead
												className={cn(DATA_TABLE_HEAD_CELL, "w-[18%]")}
											>
												Started
											</TableHead>
											<TableHead
												className={cn(DATA_TABLE_HEAD_CELL, "w-[14%] pr-4")}
											>
												Duration
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{runs.map((run) => {
											const meta = RUN_STATUS_META[run.status];
											return (
												<TableRow
													key={run.id}
													className="cursor-pointer"
													onClick={() =>
														void navigate({
															to: "/workflows/$workflowId",
															params: { workflowId: run.workflowId },
															search: { runId: run.id },
														})
													}
												>
													<TableCell className="truncate pl-4 font-medium">
														{run.workflowName}
													</TableCell>
													<TableCell>
														<span className="flex items-center gap-2">
															<span
																className={cn(
																	"size-2 shrink-0 rounded-full",
																	meta.dot,
																)}
															/>
															<span className="truncate text-sm">
																{meta.label}
															</span>
														</span>
													</TableCell>
													<TableCell className="text-muted-foreground">
														{RUN_CAUSE_LABELS[runCause(run)]}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{formatCompactRelativeTime(
															new Date(run.startedAt ?? run.createdAt),
															now,
														)}
													</TableCell>
													<TableCell className="pr-4 text-muted-foreground">
														{run.startedAt && run.finishedAt
															? formatElapsed(
																	new Date(run.startedAt),
																	new Date(run.finishedAt),
																)
															: null}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						)}
					</div>

					{hasNextPage && (
						<div className="mt-4 flex justify-center">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isFetchingNextPage}
								onClick={() => {
									void fetchNextPage();
								}}
							>
								{isFetchingNextPage ? "Loading…" : "Load more"}
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
