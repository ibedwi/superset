import type { ResolveHost } from "@superset/shared/ssrf";
import { assertConnectionHostAllowed as assertHostAllowed } from "@superset/shared/ssrf";
import { env } from "../../../env";

export function privateHostsAllowed(): boolean {
	return env.WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS === "1";
}

export function assertConnectionHostAllowed(args: {
	connection: Parameters<typeof assertHostAllowed>[0]["connection"];
	allowPrivateHosts?: boolean;
	resolveHost?: ResolveHost;
}): Promise<void> {
	return assertHostAllowed({
		...args,
		allowPrivateHosts: args.allowPrivateHosts ?? privateHostsAllowed(),
	});
}
