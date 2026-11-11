import {
	type DraftWorkflowNode,
	type WorkflowLeafCondition,
	workflowConditionLeafOps,
} from "@superset/shared/workflow-graph";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { cn } from "@superset/ui/utils";
import { useMemo, useRef, useState } from "react";
import { LuArrowRight } from "react-icons/lu";
import type { CanvasEdge, CanvasNode } from "../../../../utils/graphMapping";
import {
	CONDITION_OP_LABELS,
	conditionLeaf,
	conditionPredicate,
	describeRef,
	NUMERIC_CONDITION_OPS,
	UNARY_CONDITION_OPS,
} from "../../../../utils/nodeText";
import { DisclosureSection } from "../DisclosureSection";
import { PanelSectionLabel } from "../PanelSectionLabel";
import { ReferencePicker } from "./components/ReferencePicker";
import { upstreamNodeIds } from "./utils/upstreamNodeIds";

type ConditionConfig = Extract<
	DraftWorkflowNode,
	{ type: "condition" }
>["config"];

interface ConditionNodeFormProps {
	nodeId: string;
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	config: ConditionConfig;
	onChange: (config: ConditionConfig) => void;
	disabled: boolean;
}

export function ConditionNodeForm({
	nodeId,
	nodes,
	edges,
	config,
	onChange,
	disabled,
}: ConditionNodeFormProps) {
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const pathInputRef = useRef<HTMLInputElement>(null);
	const leaf = conditionLeaf(config) ?? {
		left: { ref: "" },
		op: "truthy" as const,
	};
	const leftRef = "ref" in leaf.left ? leaf.left.ref : "";
	const rightValue =
		leaf.right && "value" in leaf.right ? String(leaf.right.value ?? "") : "";
	const nodeName = (id: string) =>
		nodes.find((node) => node.id === id)?.data.wf.name;
	const leftLabel = leftRef ? describeRef(leftRef, nodeName) : null;

	const upstreamNodes = useMemo(() => {
		const upstream = upstreamNodeIds(nodeId, edges);
		return nodes.filter(
			(node) => upstream.has(node.id) && node.data.wf.type !== "trigger",
		);
	}, [nodeId, nodes, edges]);

	const branchTarget = (handle: "true" | "false") => {
		const names = edges
			.filter((edge) => edge.source === nodeId && edge.sourceHandle === handle)
			.map((edge) => nodeName(edge.target) ?? edge.target);
		return names.length > 0 ? names.join(", ") : null;
	};

	const update = (next: Partial<WorkflowLeafCondition>) =>
		onChange({ expression: { ...leaf, ...next } });

	const setLeftRef = (ref: string) => update({ left: { ref } });

	return (
		<div className="flex flex-col gap-4">
			<PanelSectionLabel>When</PanelSectionLabel>
			<div className="rounded-md bg-muted/50 px-3 py-2.5 text-sm">
				{leftLabel ? (
					<>
						<div>{leftLabel}</div>
						<div>{conditionPredicate(leaf)}</div>
					</>
				) : (
					<span className="text-muted-foreground">Choose a value to test</span>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>Value to test</Label>
				<ReferencePicker
					label={leftLabel}
					upstreamNodes={upstreamNodes}
					onPickNode={(pickedId) => {
						setLeftRef(`nodes.${pickedId}.output.`);
						setAdvancedOpen(true);
						requestAnimationFrame(() => pathInputRef.current?.focus());
					}}
					onPickPath={setLeftRef}
					disabled={disabled}
				/>
				{leftRef ? (
					<p className="break-all font-mono text-[11px] text-muted-foreground">
						{leftRef}
					</p>
				) : (
					<p className="text-xs text-destructive">
						Choose a source value for this test.
					</p>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>Operator</Label>
				<Select
					value={leaf.op}
					onValueChange={(op) =>
						update({ op: op as WorkflowLeafCondition["op"] })
					}
					disabled={disabled}
				>
					<SelectTrigger size="sm" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{workflowConditionLeafOps.map((op) => (
							<SelectItem key={op} value={op}>
								{CONDITION_OP_LABELS[op]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{leaf.op === "exists" && (
					<p className="text-xs text-muted-foreground">
						True when the value is neither null nor missing. Empty text, 0 and
						false still exist.
					</p>
				)}
				{leaf.op === "truthy" && (
					<p className="text-xs text-muted-foreground">
						False for empty text, 0, false, null and missing values.
					</p>
				)}
			</div>

			{!UNARY_CONDITION_OPS.has(leaf.op) && (
				<div className="flex flex-col gap-1.5">
					<Label>Compare to</Label>
					<Input
						value={rightValue}
						onChange={(event) =>
							update({ right: { value: event.target.value } })
						}
						placeholder="Value"
						disabled={disabled}
					/>
					{NUMERIC_CONDITION_OPS.has(leaf.op) && (
						<p className="text-xs text-muted-foreground">
							Numeric comparisons accept numeric text.
						</p>
					)}
				</div>
			)}

			<div className="border-t" />

			<PanelSectionLabel>Branches</PanelSectionLabel>
			<div className="flex flex-col gap-2">
				{(["true", "false"] as const).map((handle) => {
					const target = branchTarget(handle);
					const isYes = handle === "true";
					return (
						<div key={handle} className="flex items-center gap-2 text-sm">
							<span
								className={cn(
									"size-1.5 rounded-full",
									isYes ? "bg-emerald-500" : "bg-stone-400",
								)}
							/>
							<span
								className={cn(
									"w-10 shrink-0",
									isYes
										? "text-emerald-600 dark:text-emerald-400"
										: "text-muted-foreground",
								)}
							>
								{isYes ? "Yes" : "No"}
							</span>
							<span
								className={cn(
									"min-w-0 flex-1 truncate",
									!target && "text-muted-foreground",
								)}
							>
								{target ?? "Not connected"}
							</span>
							<LuArrowRight className="size-3.5 text-muted-foreground" />
						</div>
					);
				})}
				<p className="text-xs text-muted-foreground">
					Yes when the test is true. No otherwise. Connect destinations on the
					canvas.
				</p>
			</div>

			<div className="border-t" />

			<DisclosureSection
				title="Advanced · reference path"
				open={advancedOpen}
				onOpenChange={setAdvancedOpen}
			>
				<Input
					ref={pathInputRef}
					value={leftRef}
					onChange={(event) => setLeftRef(event.target.value)}
					placeholder="nodes.agent.output.text"
					disabled={disabled}
					className="font-mono text-xs"
					aria-label="Reference path"
				/>
			</DisclosureSection>
		</div>
	);
}
