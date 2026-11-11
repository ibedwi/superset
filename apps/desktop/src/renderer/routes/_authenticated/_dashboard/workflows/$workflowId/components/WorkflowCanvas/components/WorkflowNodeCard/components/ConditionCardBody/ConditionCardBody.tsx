import { Trans } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { cn } from "@superset/ui/utils";
import {
	Handle,
	Position,
	useNodeConnections,
	useNodesData,
} from "@xyflow/react";
import type { ReactNode } from "react";
import { LuArrowRight } from "react-icons/lu";
import type { CanvasNode } from "../../../../../../utils/graphMapping";
import {
	conditionLeaf,
	conditionPredicate,
	describeRef,
	refNodeId,
} from "../../../../../../utils/nodeText";

type ConditionConfig = Extract<
	DraftWorkflowNode,
	{ type: "condition" }
>["config"];

const BRANCHES = [
	{
		handleId: "true",
		label: <Trans>Yes</Trans>,
		dot: "bg-emerald-500",
		text: "text-emerald-600 dark:text-emerald-400",
	},
	{
		handleId: "false",
		label: <Trans>No</Trans>,
		dot: "bg-stone-400",
		text: "text-muted-foreground",
	},
] satisfies {
	handleId: "true" | "false";
	label: ReactNode;
	dot: string;
	text: string;
}[];

export function ConditionCardBody({ config }: { config: ConditionConfig }) {
	const leaf = conditionLeaf(config);
	const leftRef = leaf && "ref" in leaf.left ? leaf.left.ref : "";
	const refNode = useNodesData<CanvasNode>(refNodeId(leftRef) ?? "");
	const yes = useNodeConnections({ handleType: "source", handleId: "true" });
	const no = useNodeConnections({ handleType: "source", handleId: "false" });
	const targets = useNodesData<CanvasNode>(
		[...yes, ...no].map((connection) => connection.target),
	);
	const targetName = (connections: typeof yes) => {
		const names = connections.map((connection) => {
			const target = targets.find((node) => node.id === connection.target);
			return target?.data.wf.name ?? connection.target;
		});
		return names.length > 0 ? names.join(", ") : null;
	};

	return (
		<>
			<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
				<Trans>Condition</Trans>
			</div>
			{leaf && leftRef ? (
				<div className="text-sm">
					<div className="truncate">
						{describeRef(leftRef, () => refNode?.data.wf.name)}
					</div>
					<div className="truncate">{conditionPredicate(leaf)}</div>
				</div>
			) : (
				<div className="text-sm text-muted-foreground">
					<Trans>Choose a value to test</Trans>
				</div>
			)}
			<div className="border-t" />
			{BRANCHES.map((branch) => {
				const name = targetName(branch.handleId === "true" ? yes : no);
				return (
					<div
						key={branch.handleId}
						className="relative -mx-3.5 flex items-center gap-2 px-3.5 py-0.5 text-xs"
					>
						<span className={cn("size-1.5 rounded-full", branch.dot)} />
						<span className={cn("w-8 shrink-0", branch.text)}>
							{branch.label}
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 truncate",
								!name && "text-muted-foreground",
							)}
						>
							{name ?? <Trans>Not connected</Trans>}
						</span>
						<LuArrowRight className={cn("size-3.5", branch.text)} />
						<Handle
							id={branch.handleId}
							type="source"
							position={Position.Right}
						/>
					</div>
				);
			})}
		</>
	);
}
