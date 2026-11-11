import type { WorkflowNodeType } from "@superset/shared/workflow-graph";
import { cn } from "@superset/ui/utils";
import type { IconType } from "react-icons";
import {
	LuBot,
	LuGlobe,
	LuPlay,
	LuSparkles,
	LuSplit,
	LuTerminal,
} from "react-icons/lu";

const ICONS: Record<WorkflowNodeType, IconType> = {
	trigger: LuPlay,
	agent: LuBot,
	llm: LuSparkles,
	http: LuGlobe,
	condition: LuSplit,
	cli: LuTerminal,
};

const ACCENTS: Partial<Record<WorkflowNodeType, string>> = {
	trigger: "text-violet-500 dark:text-violet-400",
	condition: "text-orange-500 dark:text-orange-300",
};

interface NodeTypeIconProps {
	type: WorkflowNodeType;
	className?: string;
}

export function NodeTypeIcon({ type, className }: NodeTypeIconProps) {
	const Icon = ICONS[type];
	return (
		<Icon
			className={cn(
				"size-4 shrink-0",
				ACCENTS[type] ?? "text-muted-foreground",
				className,
			)}
		/>
	);
}
