import { CLOUD_HOST_ID } from "@superset/shared/host-routing";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions/useWorkspaceHostOptions";

/** The device name a node targets, or undefined when no device is set. */
export function useHostLabel(hostId: string | undefined): string | undefined {
	const { localHostId, currentDeviceName, otherHosts } =
		useWorkspaceHostOptions();
	if (!hostId) return undefined;
	if (hostId === CLOUD_HOST_ID) return "Cloud";
	if (hostId === localHostId) {
		return currentDeviceName ?? "This device";
	}
	return (
		otherHosts.find((host) => host.id === hostId)?.name ?? "Unknown device"
	);
}
