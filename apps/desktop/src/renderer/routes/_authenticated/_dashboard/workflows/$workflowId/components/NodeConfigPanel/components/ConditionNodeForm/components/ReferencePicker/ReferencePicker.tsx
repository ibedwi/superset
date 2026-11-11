import { Trans, useLingui } from "@lingui/react/macro";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { CanvasNode } from "../../../../../../utils/graphMapping";
import { NodeTypeIcon } from "../../../../../NodeTypeIcon";

interface ReferencePickerProps {
	label: string | null;
	upstreamNodes: CanvasNode[];
	/** A node pick inserts only its output prefix; the caller asks for the path. */
	onPickNode: (nodeId: string) => void;
	onPickPath: (path: string) => void;
	disabled: boolean;
}

export function ReferencePicker({
	label,
	upstreamNodes,
	onPickNode,
	onPickPath,
	disabled,
}: ReferencePickerProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const path = search.trim();
	const looksLikePath = /^(nodes|trigger|run)\./.test(path);

	const pick = (action: () => void) => {
		action();
		setOpen(false);
		setSearch("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild disabled={disabled}>
				<button
					type="button"
					className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
				>
					<span
						className={label ? "truncate" : "truncate text-muted-foreground"}
					>
						{label ?? t({ message: "Choose a reference…" })}
					</span>
					<LuChevronDown className="size-4 shrink-0 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<Command>
					<CommandInput
						value={search}
						onValueChange={setSearch}
						placeholder={t({ message: "Search nodes or enter a path" })}
					/>
					<CommandList>
						<CommandEmpty>
							<Trans>No matching sources.</Trans>
						</CommandEmpty>
						{looksLikePath && (
							<CommandGroup>
								<CommandItem
									value={search}
									onSelect={() => pick(() => onPickPath(path))}
								>
									<Trans>
										Use path <span className="font-mono">{path}</span>
									</Trans>
								</CommandItem>
							</CommandGroup>
						)}
						{upstreamNodes.length > 0 && (
							<CommandGroup heading={t({ message: "Upstream nodes" })}>
								{upstreamNodes.map((node) => (
									<CommandItem
										key={node.id}
										value={`${node.data.wf.name ?? ""} ${node.id}`}
										onSelect={() => pick(() => onPickNode(node.id))}
									>
										<NodeTypeIcon
											type={node.data.wf.type}
											className="size-3.5"
										/>
										<span className="truncate">
											{node.data.wf.name ?? node.id}
										</span>
										<span className="ml-auto font-mono text-[11px] text-muted-foreground">
											{node.id}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						<CommandGroup heading={t({ message: "Other sources" })}>
							<CommandItem
								value="trigger data"
								onSelect={() => pick(() => onPickPath("trigger."))}
							>
								<Trans>Trigger data</Trans>
								<span className="ml-auto font-mono text-[11px] text-muted-foreground">
									trigger.&lt;path&gt;
								</span>
							</CommandItem>
							<CommandItem
								value="run id"
								onSelect={() => pick(() => onPickPath("run.id"))}
							>
								<Trans>Run ID</Trans>
								<span className="ml-auto font-mono text-[11px] text-muted-foreground">
									run.id
								</span>
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
				<p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
					<Trans>
						Select a node, then enter its output path. Fields are known only
						after a run.
					</Trans>
				</p>
			</PopoverContent>
		</Popover>
	);
}
