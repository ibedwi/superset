import { lookup } from "node:dns/promises";
import type {
	InngestEngineConnection,
	TemporalEngineConnection,
} from "../workflow-engine/connection";
import {
	assertPublicHost,
	assertPublicUrl,
	hostFromAddress,
	type ResolveHost,
} from "./ssrf";

const systemResolver: ResolveHost = async (hostname) =>
	(await lookup(hostname, { all: true })).map((entry) => entry.address);

export async function assertConnectionHostAllowed(args: {
	connection:
		| Pick<TemporalEngineConnection, "provider" | "address">
		| Pick<InngestEngineConnection, "provider" | "baseUrl">;
	allowPrivateHosts: boolean;
	resolveHost?: ResolveHost;
}): Promise<void> {
	if (args.allowPrivateHosts) return;
	const resolveHost = args.resolveHost ?? systemResolver;
	const { connection } = args;
	if (connection.provider === "temporal") {
		await assertPublicHost({
			host: hostFromAddress(connection.address),
			resolveHost,
		});
		return;
	}
	if (connection.baseUrl) {
		await assertPublicUrl({ url: connection.baseUrl, resolveHost });
	}
}
