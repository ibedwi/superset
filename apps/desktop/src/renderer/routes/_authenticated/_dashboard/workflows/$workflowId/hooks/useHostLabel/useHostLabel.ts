import { useLingui } from "@lingui/react/macro";
import { CLOUD_HOST_ID } from "@superset/shared/host-routing";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions/useWorkspaceHostOptions";

/** The device name a node targets, or undefined when no device is set. */
export function useHostLabel(hostId: string | undefined): string | undefined {
	const { t } = useLingui();
	const { localHostId, currentDeviceName, otherHosts } =
		useWorkspaceHostOptions();
	if (!hostId) return undefined;
	if (hostId === CLOUD_HOST_ID) return t({ message: "Cloud" });
	if (hostId === localHostId) {
		return currentDeviceName ?? t({ message: "This device" });
	}
	return (
		otherHosts.find((host) => host.id === hostId)?.name ??
		t({ message: "Unknown device" })
	);
}
