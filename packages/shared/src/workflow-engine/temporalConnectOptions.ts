import type { TemporalEngineConnection } from "./connection";

export interface TemporalConnectOptions {
	address: string;
	tls:
		| boolean
		| {
				serverNameOverride?: string;
				serverRootCACertificate?: Buffer;
				clientCertPair?: { crt: Buffer; key: Buffer };
		  };
	apiKey?: string;
}

/** Connection options for the Temporal client and the native worker connection. */
export function temporalConnectOptions(
	connection: TemporalEngineConnection,
): TemporalConnectOptions {
	const { clientCertPem, clientKeyPem, serverRootCaPem, serverName } =
		connection;
	const customTls =
		serverName !== undefined ||
		serverRootCaPem !== undefined ||
		(clientCertPem !== undefined && clientKeyPem !== undefined);
	return {
		address: connection.address,
		tls:
			connection.tls && customTls
				? {
						...(serverName ? { serverNameOverride: serverName } : {}),
						...(serverRootCaPem
							? { serverRootCACertificate: Buffer.from(serverRootCaPem) }
							: {}),
						...(clientCertPem && clientKeyPem
							? {
									clientCertPair: {
										crt: Buffer.from(clientCertPem),
										key: Buffer.from(clientKeyPem),
									},
								}
							: {}),
					}
				: connection.tls,
		...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
	};
}
