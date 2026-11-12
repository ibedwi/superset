import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { useFormat } from "@superset/i18n/react";
import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import { Skeleton } from "@superset/ui/skeleton";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { ConnectInngestDialog } from "./components/ConnectInngestDialog";
import { ConnectTemporalDialog } from "./components/ConnectTemporalDialog";
import { engineRefetchInterval } from "./utils/engineRefetchInterval";

const STATUS_DOT = {
	pending: "bg-amber-500",
	connected: "bg-green-500",
	error: "bg-destructive",
} as const;

export function WorkflowEngineCard() {
	const { t } = useLingui();
	const { formatRelativeTime } = useFormat();
	const utils = cloudTrpc.useUtils();
	const [dialog, setDialog] = useState<"inngest" | "temporal" | null>(null);

	const { data, isPending, isError, error } =
		cloudTrpc.workflowEngine.get.useQuery(undefined, {
			refetchInterval: (query) => engineRefetchInterval(query.state.data),
		});

	const testMutation = cloudTrpc.workflowEngine.test.useMutation({
		onSuccess: (result) => {
			if (result.ok) {
				toast.success(t({ message: "Connection reachable" }));
			} else {
				toast.error(t({ message: "Could not reach the engine" }), {
					description: result.error ?? undefined,
				});
			}
		},
		onError: (caught) => {
			toast.error(t({ message: "Could not test the connection" }), {
				description: errorMessage(caught),
			});
		},
		onSettled: () => utils.workflowEngine.get.invalidate(),
	});

	const disconnectMutation = cloudTrpc.workflowEngine.disconnect.useMutation({
		onSuccess: () => {
			toast.success(t({ message: "Engine disconnected" }));
		},
		onError: (caught) => {
			toast.error(t({ message: "Could not disconnect" }), {
				description: errorMessage(caught),
			});
		},
		onSettled: () => utils.workflowEngine.get.invalidate(),
	});

	const confirmDisconnect = (providerName: string) => {
		alert({
			title: t({ message: "Disconnect engine" }),
			description: t({
				message: `Disconnect ${providerName}? New runs go back to the built-in engine. Run history stays in your ${providerName} account.`,
			}),
			actions: [
				{ label: t({ message: "Cancel" }), variant: "outline" },
				{
					label: t({ message: "Disconnect" }),
					variant: "destructive",
					onClick: () => disconnectMutation.mutate(),
				},
			],
		});
	};

	const connection = data?.connection ?? null;

	const renderBody = () => {
		if (isPending) return <Skeleton className="h-10 w-full" />;
		if (isError || !data) {
			return (
				<p className="text-sm text-destructive">
					{errorMessage(error, t({ message: "Could not load the engine." }))}
				</p>
			);
		}

		if (!connection) {
			return (
				<div className="space-y-3">
					<p className="text-sm text-muted-foreground">
						<Trans>
							Workflows run on the built-in engine. Connect your own Inngest or
							Temporal account to run them there instead.
						</Trans>
					</p>
					{data.canManage && (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={!data.canStoreSecrets}
								onClick={() => setDialog("inngest")}
							>
								<Trans>Connect Inngest</Trans>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={!data.canStoreSecrets}
								onClick={() => setDialog("temporal")}
							>
								<Trans>Connect Temporal</Trans>
							</Button>
						</div>
					)}
					{data.canManage && !data.canStoreSecrets && (
						<p className="text-xs text-muted-foreground">
							<Trans>
								This deployment cannot store engine credentials, so connecting
								is turned off.
							</Trans>
						</p>
					)}
				</div>
			);
		}

		const providerName =
			connection.provider === "inngest" ? "Inngest" : "Temporal";
		const target =
			connection.provider === "inngest"
				? (connection.config.baseUrl ?? t({ message: "Inngest Cloud" }))
				: `${connection.config.address} · ${connection.config.namespace}`;
		const hints =
			connection.provider === "inngest"
				? [
						connection.secretHints.eventKey && {
							key: "event",
							label: t({ message: "Event key" }),
							hint: connection.secretHints.eventKey,
						},
						connection.secretHints.signingKey && {
							key: "signing",
							label: t({ message: "Signing key" }),
							hint: connection.secretHints.signingKey,
						},
					]
				: [
						connection.secretHints.apiKey && {
							key: "api",
							label: t({ message: "API key" }),
							hint: connection.secretHints.apiKey,
						},
					];

		const lastError = connection.lastError;
		const lastChecked = connection.lastCheckedAt
			? formatRelativeTime(connection.lastCheckedAt)
			: null;

		return (
			<div className="space-y-3">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0 space-y-1">
						<div className="text-sm font-medium">{providerName}</div>
						<div className="truncate text-xs text-muted-foreground">
							{target}
						</div>
						{hints.map(
							(item) =>
								item && (
									<div key={item.key} className="text-xs text-muted-foreground">
										{item.label}: ····{item.hint}
									</div>
								),
						)}
						<div className="flex items-center gap-1.5 pt-1">
							<span
								className={`size-2 rounded-full ${STATUS_DOT[connection.status]}`}
							/>
							<span className="text-xs text-muted-foreground">
								{connection.status === "pending" && (
									<Trans>Waiting for the worker to connect</Trans>
								)}
								{connection.status === "connected" && <Trans>Connected</Trans>}
								{connection.status === "error" && (
									<Trans>Error: {lastError}</Trans>
								)}
							</span>
						</div>
						{lastChecked && (
							<div className="text-xs text-muted-foreground">
								<Trans>Last checked {lastChecked}</Trans>
							</div>
						)}
					</div>
					{data.canManage && (
						<div className="flex shrink-0 items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={testMutation.isPending}
								onClick={() => testMutation.mutate()}
							>
								<Trans>Test</Trans>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={disconnectMutation.isPending}
								onClick={() => confirmDisconnect(providerName)}
							>
								<Trans>Disconnect</Trans>
							</Button>
						</div>
					)}
				</div>
			</div>
		);
	};

	return (
		<section className="mt-8 space-y-3">
			<div>
				<h3 className="text-sm font-medium">
					<Trans>Workflow engine</Trans>
				</h3>
			</div>
			<div className="rounded-lg border p-4">{renderBody()}</div>
			<ConnectInngestDialog
				open={dialog === "inngest"}
				onOpenChange={(open) => setDialog(open ? "inngest" : null)}
			/>
			<ConnectTemporalDialog
				open={dialog === "temporal"}
				onOpenChange={(open) => setDialog(open ? "temporal" : null)}
			/>
		</section>
	);
}
