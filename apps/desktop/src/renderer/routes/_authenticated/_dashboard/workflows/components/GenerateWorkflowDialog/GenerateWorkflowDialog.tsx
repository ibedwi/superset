import { errorMessage } from "@superset/i18n/errors";
import type { DraftWorkflowGraph } from "@superset/shared/workflow-graph";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Spinner } from "@superset/ui/spinner";
import { Textarea } from "@superset/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@superset/ui/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LuSparkles } from "react-icons/lu";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";

export type GeneratedWorkflow = Awaited<
	ReturnType<typeof apiTrpcClient.workflow.generateGraph.mutate>
>;

type Mode = "extend" | "replace";

interface GenerateWorkflowDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	getCurrentGraph?: () => DraftWorkflowGraph;
	onGenerated: (result: GeneratedWorkflow) => Promise<void> | void;
}

export function GenerateWorkflowDialog({
	open,
	onOpenChange,
	title,
	description,
	getCurrentGraph,
	onGenerated,
}: GenerateWorkflowDialogProps) {
	const [prompt, setPrompt] = useState("");
	const [mode, setMode] = useState<Mode>("extend");
	// A closed dialog drops the reply of the request it started.
	const requestRef = useRef(0);

	const generateMutation = useMutation({
		mutationFn: async (input: { prompt: string; mode: Mode }) => {
			const request = ++requestRef.current;
			const graph =
				getCurrentGraph && input.mode === "extend"
					? getCurrentGraph()
					: undefined;
			const result = await apiTrpcClient.workflow.generateGraph.mutate({
				description: input.prompt,
				...(graph ? { graph } : {}),
			});
			if (request !== requestRef.current) return;
			await onGenerated(result);
			setPrompt("");
			onOpenChange(false);
		},
	});

	const close = (next: boolean) => {
		if (!next) {
			requestRef.current++;
			generateMutation.reset();
		}
		onOpenChange(next);
	};

	const submit = () => {
		const text = prompt.trim();
		if (!text || generateMutation.isPending) return;
		generateMutation.mutate({ prompt: text, mode });
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					{getCurrentGraph && (
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							value={mode}
							onValueChange={(value) => {
								if (value === "extend" || value === "replace") setMode(value);
							}}
							disabled={generateMutation.isPending}
						>
							<ToggleGroupItem value="extend">
								Change current graph
							</ToggleGroupItem>
							<ToggleGroupItem value="replace">Start over</ToggleGroupItem>
						</ToggleGroup>
					)}
					<Textarea
						autoFocus
						rows={5}
						maxLength={4000}
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								submit();
							}
						}}
						placeholder="Every morning, fetch open PRs from GitHub, summarize them with an LLM, and post the summary to a webhook."
						disabled={generateMutation.isPending}
						aria-label="Workflow description"
					/>
					{generateMutation.isError && (
						<p className="text-sm text-destructive">
							{errorMessage(
								generateMutation.error,
								"Failed to generate the workflow",
							)}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => close(false)}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!prompt.trim() || generateMutation.isPending}
						>
							{generateMutation.isPending ? (
								<Spinner className="size-3.5" />
							) : (
								<LuSparkles className="size-3.5" />
							)}
							{generateMutation.isPending ? "Generating…" : "Generate"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
