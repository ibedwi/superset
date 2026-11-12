import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
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
import { toast } from "@superset/ui/sonner";
import { useEffect, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import {
	buildInngestConnectInput,
	EMPTY_INNGEST_FORM,
	type InngestFormIssue,
	type InngestFormState,
	inngestFormIssue,
} from "../../utils/inngestConnectInput";

interface ConnectInngestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ConnectInngestDialog({
	open,
	onOpenChange,
}: ConnectInngestDialogProps) {
	const { t } = useLingui();
	const utils = cloudTrpc.useUtils();
	const [form, setForm] = useState<InngestFormState>(EMPTY_INNGEST_FORM);
	const [issue, setIssue] = useState<InngestFormIssue | null>(null);

	const connect = cloudTrpc.workflowEngine.connect.useMutation({
		onSuccess: async () => {
			await utils.workflowEngine.get.invalidate();
			toast.success(t({ message: "Inngest connected" }));
			onOpenChange(false);
		},
	});
	const { reset: resetMutation } = connect;

	useEffect(() => {
		if (open) return;
		setForm(EMPTY_INNGEST_FORM);
		setIssue(null);
		resetMutation();
	}, [open, resetMutation]);

	const issueMessages: Record<InngestFormIssue, string> = {
		eventKey: t({ message: "Enter the event key." }),
		signingKey: t({ message: "Enter the signing key." }),
		baseUrl: t({ message: "The base URL is not a valid URL." }),
	};

	const update = (patch: Partial<InngestFormState>) => {
		setForm((current) => ({ ...current, ...patch }));
		setIssue(null);
	};

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const found = inngestFormIssue(form);
		setIssue(found);
		if (found) return;
		connect.mutate(buildInngestConnectInput(form));
	};

	const message = issue
		? issueMessages[issue]
		: connect.error
			? errorMessage(connect.error)
			: null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Connect Inngest</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Nothing needs to be deployed: your Inngest account stores the run
							history, and this platform's worker does the work.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="inngest-event-key">
							<Trans>Event key</Trans>
						</Label>
						<Input
							id="inngest-event-key"
							type="password"
							autoComplete="off"
							value={form.eventKey}
							onChange={(event) => update({ eventKey: event.target.value })}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="inngest-signing-key">
							<Trans>Signing key</Trans>
						</Label>
						<Input
							id="inngest-signing-key"
							type="password"
							autoComplete="off"
							value={form.signingKey}
							onChange={(event) => update({ signingKey: event.target.value })}
						/>
					</div>
					<Collapsible>
						<CollapsibleTrigger className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
							<LuChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
							<Trans>Self-hosted</Trans>
						</CollapsibleTrigger>
						<CollapsibleContent className="mt-2 space-y-2">
							<Label htmlFor="inngest-base-url">
								<Trans>Base URL</Trans>
							</Label>
							<Input
								id="inngest-base-url"
								placeholder="https://inngest.example.com"
								value={form.baseUrl}
								onChange={(event) => update({ baseUrl: event.target.value })}
							/>
							<p className="text-xs text-muted-foreground">
								<Trans>Leave empty to use Inngest Cloud.</Trans>
							</p>
						</CollapsibleContent>
					</Collapsible>
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
