import { CLOUD_HOST_ID } from "@superset/shared/host-routing";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions/useWorkspaceHostOptions";

interface HostSelectProps {
	value: string | undefined;
	onChange: (hostId: string) => void;
	allowCloud: boolean;
	disabled?: boolean;
}

export function HostSelect({
	value,
	onChange,
	allowCloud,
	disabled,
}: HostSelectProps) {
	const { localHostId, currentDeviceName, otherHosts } =
		useWorkspaceHostOptions();
	return (
		<Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger size="sm" className="w-full">
				<SelectValue placeholder="Select a device" />
			</SelectTrigger>
			<SelectContent>
				{allowCloud && <SelectItem value={CLOUD_HOST_ID}>Cloud</SelectItem>}
				{localHostId && (
					<SelectItem value={localHostId}>
						{currentDeviceName ?? "This device"}
					</SelectItem>
				)}
				{otherHosts.map((host) => (
					<SelectItem key={host.id} value={host.id}>
						{host.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
