import { rawErrorMessage } from "@superset/i18n/errors";
import {
	type TemporalEngineConnection,
	temporalConnectOptions,
} from "@superset/shared/workflow-engine";
import type { Client } from "@temporalio/client";

const MAX_CACHED_CONNECTIONS = 50;

interface CachedClient {
	version: string;
	client: Promise<Client>;
}

const cache = new Map<string, CachedClient>();

function closeQuietly(client: Promise<Client>): void {
	client
		.then((ready) => ready.connection.close())
		.catch((error: unknown) => {
			console.warn(
				"[workflow-engine] closing a Temporal client failed",
				rawErrorMessage(error),
			);
		});
}

async function connectClient(
	connection: TemporalEngineConnection,
): Promise<Client> {
	const { Client, Connection } = await import("@temporalio/client");
	const native = await Connection.connect(temporalConnectOptions(connection));
	return new Client({ connection: native, namespace: connection.namespace });
}

/** One client per connection id and version; an edited connection gets a new one. */
export function temporalClientFor(
	connection: TemporalEngineConnection,
): Promise<Client> {
	const cached = cache.get(connection.id);
	if (cached?.version === connection.updatedAt) return cached.client;
	if (cached) closeQuietly(cached.client);
	cache.delete(connection.id);

	const client = connectClient(connection);
	client.catch(() => {
		if (cache.get(connection.id)?.client === client) {
			cache.delete(connection.id);
		}
	});
	cache.set(connection.id, { version: connection.updatedAt, client });

	const oldest = cache.keys().next().value;
	if (cache.size > MAX_CACHED_CONNECTIONS && oldest !== undefined) {
		const evicted = cache.get(oldest);
		cache.delete(oldest);
		if (evicted) closeQuietly(evicted.client);
	}
	return client;
}

export function cachedTemporalClientCount(): number {
	return cache.size;
}

export function resetTemporalClientCache(): void {
	for (const entry of cache.values()) closeQuietly(entry.client);
	cache.clear();
}
