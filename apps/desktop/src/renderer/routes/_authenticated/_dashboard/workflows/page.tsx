import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { formatCompactRelativeTime } from "@superset/i18n/format";
import { COMPANY } from "@superset/shared/constants";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@superset/ui/empty";
import { Skeleton } from "@superset/ui/skeleton";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superset/ui/table";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LuEllipsisVertical } from "react-icons/lu";
import { useNow } from "renderer/hooks/useNow";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { FeatureHeader } from "renderer/routes/_authenticated/_dashboard/components/FeatureHeader";
import { PageHeader } from "renderer/routes/_authenticated/_dashboard/components/PageHeader";

export const Route = createFileRoute("/_authenticated/_dashboard/workflows/")({
	component: WorkflowsListPage,
});

function WorkflowsListPage() {
	const { t } = useLingui();
	const navigate = useNavigate();
	const utils = cloudTrpc.useUtils();
	const now = useNow(60_000);

	const workflowsQuery = cloudTrpc.workflow.list.useQuery(undefined, {
		staleTime: 30_000,
	});
	const workflows = workflowsQuery.data ?? [];

	const invalidate = () => void utils.workflow.list.invalidate();

	const createMutation = useMutation({
		mutationFn: () =>
			apiTrpcClient.workflow.create.mutate({
				name: t({ message: "New workflow" }),
			}),
		onSuccess: (workflow) => {
			invalidate();
			void navigate({
				to: "/workflows/$workflowId",
				params: { workflowId: workflow.id },
			});
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to create workflow" })),
			),
	});

	const setEnabledMutation = useMutation({
		mutationFn: (input: { id: string; enabled: boolean }) =>
			apiTrpcClient.workflow.update.mutate(input),
		onSuccess: invalidate,
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to update workflow" })),
			),
	});

	const archiveMutation = useMutation({
		mutationFn: (id: string) => apiTrpcClient.workflow.archive.mutate({ id }),
		onSuccess: () => {
			invalidate();
			toast.success(t({ message: "Workflow archived" }));
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to archive workflow" })),
			),
	});

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<PageHeader />

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 pt-4 pb-12">
					<FeatureHeader
						title={<Trans>Workflows</Trans>}
						docsUrl={`${COMPANY.DOCS_URL}/workflows`}
						onCreate={() => createMutation.mutate()}
						isCreating={createMutation.isPending}
						primaryAction={{
							label: <Trans>New workflow</Trans>,
							onSelect: () => createMutation.mutate(),
							disabled: createMutation.isPending,
						}}
					/>

					<div className="mt-5">
						{workflowsQuery.isPending ? (
							<div className="flex flex-col gap-2">
								{["a", "b", "c"].map((key) => (
									<Skeleton key={key} className="h-10 w-full" />
								))}
							</div>
						) : workflows.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>
										<Trans>No workflows yet</Trans>
									</EmptyTitle>
									<EmptyDescription>
										<Trans>
											Build a canvas of agent, LLM, API, and command steps that
											runs on a schedule or an event.
										</Trans>
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>
											<Trans>Name</Trans>
										</TableHead>
										<TableHead className="w-28">
											<Trans>Enabled</Trans>
										</TableHead>
										<TableHead className="w-28">
											<Trans>Updated</Trans>
										</TableHead>
										<TableHead className="w-10" />
									</TableRow>
								</TableHeader>
								<TableBody>
									{workflows.map((workflow) => (
										<TableRow
											key={workflow.id}
											className="cursor-pointer"
											onClick={() =>
												void navigate({
													to: "/workflows/$workflowId",
													params: { workflowId: workflow.id },
												})
											}
										>
											<TableCell className="font-medium">
												{workflow.name}
											</TableCell>
											<TableCell onClick={(event) => event.stopPropagation()}>
												<Switch
													checked={workflow.enabled}
													onCheckedChange={(enabled) =>
														setEnabledMutation.mutate({
															id: workflow.id,
															enabled,
														})
													}
													disabled={setEnabledMutation.isPending}
													aria-label={t({ message: "Enabled" })}
												/>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{formatCompactRelativeTime(
													new Date(workflow.updatedAt),
													now,
												)}
											</TableCell>
											<TableCell onClick={(event) => event.stopPropagation()}>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															size="icon-sm"
															aria-label={t({ message: "Workflow actions" })}
														>
															<LuEllipsisVertical className="size-3.5" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															onSelect={() =>
																archiveMutation.mutate(workflow.id)
															}
														>
															<Trans>Archive</Trans>
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
