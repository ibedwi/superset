import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { RadioGroup, RadioGroupItem } from "@superset/ui/radio-group";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useState } from "react";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import {
	buildTemporalConnectInput,
	EMPTY_TEMPORAL_FORM,
	type TemporalAuthentication,
	type TemporalFormIssue,
	type TemporalFormState,
	temporalFormIssue,
	temporalTlsLocked,
} from "../../utils/temporalConnectInput";

interface ConnectTemporalDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const PEM_PLACEHOLDER = "-----BEGIN ...-----";
const ADDRESS_PLACEHOLDER = "my-namespace.a1b2c.tmprl.cloud:7233";
const NAMESPACE_PLACEHOLDER = "my-namespace.a1b2c";

export function ConnectTemporalDialog({
	open,
	onOpenChange,
}: ConnectTemporalDialogProps) {
	const { t } = useLingui();
	const utils = cloudTrpc.useUtils();
	const [form, setForm] = useState<TemporalFormState>(EMPTY_TEMPORAL_FORM);
	const [issue, setIssue] = useState<TemporalFormIssue | null>(null);

	const connect = cloudTrpc.workflowEngine.connect.useMutation({
		onSuccess: async () => {
			await utils.workflowEngine.get.invalidate();
			toast.success(t({ message: "Temporal connected" }));
			onOpenChange(false);
		},
	});
	const { reset: resetMutation } = connect;

	useEffect(() => {
		if (open) return;
		setForm(EMPTY_TEMPORAL_FORM);
		setIssue(null);
		resetMutation();
	}, [open, resetMutation]);

	const issueMessages: Record<TemporalFormIssue, string> = {
		address: t({
			message: "Enter the address as host:port, without https://.",
		}),
		namespace: t({ message: "Enter the namespace." }),
		apiKey: t({ message: "Enter the API key." }),
		clientCertPem: t({
			message: "Paste the client certificate in PEM format.",
		}),
		clientKeyPem: t({ message: "Paste the client key in PEM format." }),
		serverRootCaPem: t({
			message: "The CA certificate must be in PEM format.",
		}),
		serverNameNeedsTls: t({ message: "Turn on TLS to set a server name." }),
	};

	const update = (patch: Partial<TemporalFormState>) => {
		setForm((current) => ({ ...current, ...patch }));
		setIssue(null);
	};

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const found = temporalFormIssue(form);
		setIssue(found);
		if (found) return;
		connect.mutate(buildTemporalConnectInput(form));
	};

	const message = issue
		? issueMessages[issue]
		: connect.error
			? errorMessage(connect.error)
			: null;
	const tlsLocked = temporalTlsLocked(form.authentication);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						<Trans>Connect Temporal</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Nothing needs to be deployed: your Temporal namespace stores the
							run history, and this platform's worker does the work.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="temporal-address">
							<Trans>Address</Trans>
						</Label>
						<Input
							id="temporal-address"
							placeholder={ADDRESS_PLACEHOLDER}
							value={form.address}
							onChange={(event) => update({ address: event.target.value })}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="temporal-namespace">
							<Trans>Namespace</Trans>
						</Label>
						<Input
							id="temporal-namespace"
							placeholder={NAMESPACE_PLACEHOLDER}
							value={form.namespace}
							onChange={(event) => update({ namespace: event.target.value })}
						/>
					</div>
					<div className="space-y-2">
						<Label>
							<Trans>Authentication</Trans>
						</Label>
						<RadioGroup
							value={form.authentication}
							onValueChange={(value) =>
								update({ authentication: value as TemporalAuthentication })
							}
							className="flex gap-4"
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem value="api_key" id="temporal-auth-api-key" />
								<Label htmlFor="temporal-auth-api-key">
									<Trans>API key</Trans>
								</Label>
							</div>
							<div className="flex items-center gap-2">
								<RadioGroupItem
									value="client_certificate"
									id="temporal-auth-certificate"
								/>
								<Label htmlFor="temporal-auth-certificate">
									<Trans>Client certificate</Trans>
								</Label>
							</div>
							<div className="flex items-center gap-2">
								<RadioGroupItem value="none" id="temporal-auth-none" />
								<Label htmlFor="temporal-auth-none">
									<Trans>None</Trans>
								</Label>
							</div>
						</RadioGroup>
					</div>
					{form.authentication === "api_key" && (
						<div className="space-y-2">
							<Label htmlFor="temporal-api-key">
								<Trans>API key</Trans>
							</Label>
							<Input
								id="temporal-api-key"
								type="password"
								autoComplete="off"
								value={form.apiKey}
								onChange={(event) => update({ apiKey: event.target.value })}
							/>
						</div>
					)}
					{form.authentication === "client_certificate" && (
						<>
							<div className="space-y-2">
								<Label htmlFor="temporal-client-cert">
									<Trans>Client certificate (PEM)</Trans>
								</Label>
								<Textarea
									id="temporal-client-cert"
									className="font-mono text-xs"
									rows={4}
									placeholder={PEM_PLACEHOLDER}
									value={form.clientCertPem}
									onChange={(event) =>
										update({ clientCertPem: event.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="temporal-client-key">
									<Trans>Client key (PEM)</Trans>
								</Label>
								<Textarea
									id="temporal-client-key"
									className="font-mono text-xs"
									rows={4}
									placeholder={PEM_PLACEHOLDER}
									value={form.clientKeyPem}
									onChange={(event) =>
										update({ clientKeyPem: event.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="temporal-ca">
									<Trans>CA certificate (PEM, optional)</Trans>
								</Label>
								<Textarea
									id="temporal-ca"
									className="font-mono text-xs"
									rows={4}
									placeholder={PEM_PLACEHOLDER}
									value={form.serverRootCaPem}
									onChange={(event) =>
										update({ serverRootCaPem: event.target.value })
									}
								/>
							</div>
						</>
					)}
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="temporal-tls">
							<Trans>TLS</Trans>
						</Label>
						<Switch
							id="temporal-tls"
							checked={tlsLocked || form.tls}
							disabled={tlsLocked}
							onCheckedChange={(tls) => update({ tls })}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="temporal-server-name">
							<Trans>Server name (optional)</Trans>
						</Label>
						<Input
							id="temporal-server-name"
							value={form.serverName}
							onChange={(event) => update({ serverName: event.target.value })}
						/>
					</div>
					{message && (
						<p role="alert" className="text-sm text-destructive">
							{message}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={connect.isPending}>
							{connect.isPending ? (
								<Trans>Connecting...</Trans>
							) : (
								<Trans>Connect</Trans>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
