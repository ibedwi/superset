import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { useState } from "react";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useHostLabel } from "../../../../hooks/useHostLabel";
import { BoundedNumberField } from "../BoundedNumberField";
import { DisclosureSection } from "../DisclosureSection";
import { HostSelect } from "../HostSelect";

type CliConfig = Extract<DraftWorkflowNode, { type: "cli" }>["config"];

const DEFAULT_TIMEOUT_MINUTES = 30;
const NO_WORKSPACE = "__none__";
const MANUAL_WORKSPACE = "__manual__";

interface CliNodeFormProps {
	config: CliConfig;
	onChange: (config: CliConfig) => void;
	disabled: boolean;
}

export function CliNodeForm({ config, onChange, disabled }: CliNodeFormProps) {
	const hostId = config.target?.hostId;
	const workspaceId = config.target?.v2WorkspaceId;
	const hostLabel = useHostLabel(hostId);
	const { workspaces } = useHostWorkspaces();
	const hostWorkspaces = workspaces.filter(
		(workspace) => workspace.hostId === hostId && !workspace.archivedAt,
	);
	const selectedWorkspace = hostWorkspaces.find(
		(workspace) => workspace.id === workspaceId,
	);
	const [manualEntry, setManualEntry] = useState(false);
	const showManual = manualEntry || (!!workspaceId && !selectedWorkspace);
	const timeoutMinutes = config.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;

	const setWorkspace = (v2WorkspaceId: string | undefined) => {
		if (!config.target) return;
		onChange({ ...config, target: { ...config.target, v2WorkspaceId } });
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="text-sm font-medium">Execution context</div>

			<div className="flex flex-col gap-1.5">
				<Label>Device</Label>
				<HostSelect
					value={hostId}
					onChange={(nextHostId) =>
						onChange({ ...config, target: { hostId: nextHostId } })
					}
					allowCloud={false}
					disabled={disabled}
				/>
				<p className="text-xs text-muted-foreground">
					Runs on a connected device. Cloud is unavailable.
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>Workspace</Label>
				{showManual ? (
					<>
						<Input
							value={workspaceId ?? ""}
							onChange={(event) =>
								setWorkspace(event.target.value || undefined)
							}
							placeholder="Workspace ID"
							disabled={disabled || !hostId}
							className="font-mono text-xs"
						/>
						<button
							type="button"
							className="self-start text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none"
							onClick={() => {
								setManualEntry(false);
								if (!selectedWorkspace) setWorkspace(undefined);
							}}
							disabled={disabled}
						>
							Use workspace picker
						</button>
					</>
				) : (
					<Select
						value={hostId ? (workspaceId ?? NO_WORKSPACE) : ""}
						onValueChange={(value) => {
							if (value === MANUAL_WORKSPACE) {
								setManualEntry(true);
								return;
							}
							setWorkspace(value === NO_WORKSPACE ? undefined : value);
						}}
						disabled={disabled || !hostId}
					>
						<SelectTrigger size="sm" className="w-full">
							<SelectValue placeholder="Choose a device first" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_WORKSPACE}>No workspace</SelectItem>
							{hostWorkspaces.map((workspace) => (
								<SelectItem key={workspace.id} value={workspace.id}>
									<div className="flex flex-col">
										<span>{workspace.name}</span>
										<span className="text-[11px] text-muted-foreground">
											{workspace.branch}
										</span>
									</div>
								</SelectItem>
							))}
							<SelectSeparator />
							<SelectItem value={MANUAL_WORKSPACE}>
								Enter workspace ID manually…
							</SelectItem>
						</SelectContent>
					</Select>
				)}
				<p className="text-xs text-muted-foreground">
					{hostId
						? "Runs in the selected workspace's working directory on this device."
						: "Select a device to browse its workspaces."}
				</p>
			</div>

			<div className="border-t" />

			<div className="flex flex-col gap-1.5">
				<Label>Shell command</Label>
				<div className="rounded-md border bg-muted/50 dark:bg-black/30">
					<div className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						Shell
					</div>
					<Textarea
						value={config.command ?? ""}
						onChange={(event) =>
							onChange({ ...config, command: event.target.value })
						}
						placeholder="bun run test"
						rows={5}
						disabled={disabled}
						className="min-h-28 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
						aria-label="Shell command"
					/>
					<div className="px-3 pb-2 text-[11px] text-muted-foreground">
						Plain text · wraps long lines
					</div>
				</div>
				{hostLabel && config.command && (
					<div className="flex flex-col gap-1 pt-1">
						<div className="text-xs text-muted-foreground">Command preview</div>
						<div className="whitespace-pre-wrap break-all text-xs">
							<div className="text-muted-foreground">
								{hostLabel}
								{selectedWorkspace || workspaceId
									? ` → ${selectedWorkspace?.name ?? workspaceId}`
									: ""}
							</div>
							<div className="font-mono">{config.command}</div>
						</div>
					</div>
				)}
			</div>

			<div className="border-t" />

			<DisclosureSection
				title="Execution limits"
				trailing={`${timeoutMinutes} min`}
			>
				<BoundedNumberField
					label="Timeout"
					unit="minutes"
					value={timeoutMinutes}
					min={1}
					max={120}
					defaultValue={DEFAULT_TIMEOUT_MINUTES}
					onChange={(timeoutMinutes) => onChange({ ...config, timeoutMinutes })}
					disabled={disabled}
				/>
			</DisclosureSection>
		</div>
	);
}
